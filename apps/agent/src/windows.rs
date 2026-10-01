use std::ffi::{OsStr, c_void};
use std::fs::File;
use std::io;
use std::os::windows::ffi::OsStrExt;
use std::os::windows::fs::MetadataExt;
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
use std::path::{Component, Path, PathBuf};
use std::ptr::{null, null_mut};
use windows_sys::Wdk::Foundation::OBJECT_ATTRIBUTES;
use windows_sys::Wdk::Storage::FileSystem::{
    FILE_CREATE, FILE_NON_DIRECTORY_FILE, FILE_OPEN, FILE_OPEN_IF, FILE_OPEN_REPARSE_POINT,
    FILE_RENAME_INFORMATION, FILE_SYNCHRONOUS_IO_NONALERT, FileRenameInformation, NtCreateFile,
    NtSetInformationFile,
};
use windows_sys::Win32::Foundation::{
    GENERIC_READ, GENERIC_WRITE, INVALID_HANDLE_VALUE, LocalFree, RtlNtStatusToDosError,
    UNICODE_STRING,
};
use windows_sys::Win32::Security::Authorization::{
    ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW, GetSecurityInfo,
    SE_FILE_OBJECT,
};
use windows_sys::Win32::Security::{
    ACCESS_ALLOWED_ACE, ACL, DACL_SECURITY_INFORMATION, EqualSid, GetAce,
    GetSecurityDescriptorControl, GetTokenInformation, OWNER_SECURITY_INFORMATION,
    SE_DACL_PROTECTED, SECURITY_ATTRIBUTES, TOKEN_QUERY, TOKEN_USER, TokenUser,
};
use windows_sys::Win32::Storage::FileSystem::{
    CreateDirectoryW, CreateFileW, DELETE, FILE_ATTRIBUTE_NORMAL, FILE_ATTRIBUTE_REPARSE_POINT,
    FILE_DISPOSITION_INFO, FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT,
    FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE, FILE_TRAVERSE, FileDispositionInfo,
    LOCKFILE_EXCLUSIVE_LOCK, LockFileEx, OPEN_EXISTING, SYNCHRONIZE, SetFileInformationByHandle,
};
use windows_sys::Win32::System::IO::OVERLAPPED;
use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

pub(crate) fn wide(value: impl AsRef<OsStr>) -> io::Result<Vec<u16>> {
    let mut value: Vec<u16> = value.as_ref().encode_wide().collect();
    if value.contains(&0) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "path contains NUL",
        ));
    }
    value.push(0);
    Ok(value)
}

struct LocalAllocation(*mut c_void);

impl Drop for LocalAllocation {
    fn drop(&mut self) {
        unsafe { LocalFree(self.0) };
    }
}

fn token_user() -> io::Result<Vec<usize>> {
    let mut handle = null_mut();
    if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut handle) } == 0 {
        return Err(io::Error::last_os_error());
    }
    let handle = unsafe { OwnedHandle::from_raw_handle(handle) };
    let mut size = 0;
    unsafe { GetTokenInformation(handle.as_raw_handle(), TokenUser, null_mut(), 0, &mut size) };
    let mut buffer = vec![0usize; (size as usize).div_ceil(size_of::<usize>())];
    if unsafe {
        GetTokenInformation(
            handle.as_raw_handle(),
            TokenUser,
            buffer.as_mut_ptr().cast(),
            size,
            &mut size,
        )
    } == 0
    {
        return Err(io::Error::last_os_error());
    }
    Ok(buffer)
}

pub(crate) fn user_sid() -> io::Result<String> {
    let buffer = token_user()?;
    let sid = unsafe { (*(buffer.as_ptr().cast::<TOKEN_USER>())).User.Sid };
    let mut string = null_mut();
    if unsafe { ConvertSidToStringSidW(sid, &mut string) } == 0 {
        return Err(io::Error::last_os_error());
    }
    let _allocation = LocalAllocation(string.cast());
    let mut length = 0;
    while unsafe { *string.add(length) } != 0 {
        length += 1;
    }
    Ok(String::from_utf16_lossy(unsafe {
        std::slice::from_raw_parts(string, length)
    }))
}

pub(crate) struct PrivateSecurity(LocalAllocation);

impl PrivateSecurity {
    pub(crate) fn new() -> io::Result<Self> {
        let sid = user_sid()?;
        let sddl = wide(format!("O:{sid}D:P(A;OICI;FA;;;{sid})"))?;
        let mut descriptor = null_mut();
        if unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                sddl.as_ptr(),
                1,
                &mut descriptor,
                null_mut(),
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        Ok(Self(LocalAllocation(descriptor)))
    }

    pub(crate) fn attributes(&self) -> SECURITY_ATTRIBUTES {
        SECURITY_ATTRIBUTES {
            nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: self.0.0,
            bInheritHandle: 0,
        }
    }
}

pub(crate) fn validate_private_handle(handle: &impl AsRawHandle) -> io::Result<()> {
    validate_private_acl(handle, false)
}

fn validate_private_acl(handle: &impl AsRawHandle, directory: bool) -> io::Result<()> {
    let user = token_user()?;
    let sid = unsafe { (*(user.as_ptr().cast::<TOKEN_USER>())).User.Sid };
    let mut owner = null_mut();
    let mut dacl: *mut ACL = null_mut();
    let mut descriptor = null_mut();
    let error = unsafe {
        GetSecurityInfo(
            handle.as_raw_handle(),
            SE_FILE_OBJECT,
            OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
            &mut owner,
            null_mut(),
            &mut dacl,
            null_mut(),
            &mut descriptor,
        )
    };
    if error != 0 {
        return Err(io::Error::from_raw_os_error(error as i32));
    }
    let _allocation = LocalAllocation(descriptor);
    if owner.is_null() || dacl.is_null() || unsafe { EqualSid(owner, sid) } == 0 {
        return Err(unsafe_storage());
    }
    let mut inherited_children = false;
    for index in 0..unsafe { (*dacl).AceCount } {
        let mut ace = null_mut();
        if unsafe { GetAce(dacl, index.into(), &mut ace) } == 0 {
            return Err(io::Error::last_os_error());
        }
        let ace = ace.cast::<ACCESS_ALLOWED_ACE>();
        if unsafe { (*ace).Header.AceType } != 0
            || unsafe { EqualSid(std::ptr::addr_of!((*ace).SidStart).cast_mut().cast(), sid) } == 0
        {
            return Err(unsafe_storage());
        }
        inherited_children |= unsafe { (*ace).Header.AceFlags } & 3 == 3;
    }
    if directory {
        let mut control = 0;
        let mut revision = 0;
        if unsafe { GetSecurityDescriptorControl(descriptor, &mut control, &mut revision) } == 0
            || control & SE_DACL_PROTECTED == 0
            || !inherited_children
        {
            return Err(unsafe_storage());
        }
    }
    Ok(())
}

fn unsafe_storage() -> io::Error {
    io::Error::new(
        io::ErrorKind::PermissionDenied,
        "storage must be owned by the current user with an ACL granting access only to that user",
    )
}

pub(crate) struct PrivateDirectory {
    _handles: Vec<File>,
}

impl PrivateDirectory {
    fn handle(&self) -> &File {
        self._handles
            .last()
            .expect("private directory has a handle")
    }

    pub(crate) fn open_file(
        &self,
        name: &OsStr,
        create: bool,
        exclusive: bool,
    ) -> io::Result<File> {
        self.open(name, create, exclusive, false)
    }

    pub(crate) fn create_temporary_file(&self, name: &OsStr) -> io::Result<File> {
        self.open(name, true, true, true)
    }

    fn open(
        &self,
        name: &OsStr,
        create: bool,
        exclusive: bool,
        delete_access: bool,
    ) -> io::Result<File> {
        if Path::new(name).components().count() != 1 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "private file name must be a single path component",
            ));
        }
        open_relative_file(self.handle(), name, create, exclusive, delete_access)
    }

    pub(crate) fn replace(&self, source: &File, destination: &OsStr) -> io::Result<()> {
        if Path::new(destination).components().count() != 1 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "private file name must be a single path component",
            ));
        }
        replace_relative(self.handle(), source, destination)
    }
}

pub(crate) fn open_private_directory(path: &Path) -> io::Result<PrivateDirectory> {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()?.join(path)
    };
    let security = PrivateSecurity::new()?;
    let attributes = security.attributes();
    let mut current = PathBuf::new();
    let mut handles = Vec::new();
    for component in absolute.components() {
        match component {
            Component::Prefix(_) | Component::RootDir => {
                current.push(component);
                continue;
            }
            Component::CurDir => continue,
            Component::ParentDir => {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "private storage path contains ..",
                ));
            }
            Component::Normal(_) => current.push(component),
        }
        let name = wide(&current)?;
        let directory = match open_handle(
            &name,
            0x00020000 | FILE_TRAVERSE,
            OPEN_EXISTING,
            null(),
            true,
        ) {
            Ok(file) => file,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                if unsafe { CreateDirectoryW(name.as_ptr(), &attributes) } == 0
                    && io::Error::last_os_error().kind() != io::ErrorKind::AlreadyExists
                {
                    return Err(io::Error::last_os_error());
                }
                open_handle(
                    &name,
                    0x00020000 | FILE_TRAVERSE,
                    OPEN_EXISTING,
                    null(),
                    true,
                )?
            }
            Err(error) => return Err(error),
        };
        let metadata = directory.metadata()?;
        if !metadata.is_dir() || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "private storage path contains a reparse point or non-directory",
            ));
        }
        handles.push(directory);
    }
    let final_directory = handles.last().ok_or_else(unsafe_storage)?;
    validate_private_acl(final_directory, true)?;
    Ok(PrivateDirectory { _handles: handles })
}

fn open_handle(
    name: &[u16],
    access: u32,
    disposition: u32,
    attributes: *const SECURITY_ATTRIBUTES,
    directory: bool,
) -> io::Result<File> {
    let flags = FILE_FLAG_OPEN_REPARSE_POINT
        | if directory {
            FILE_FLAG_BACKUP_SEMANTICS
        } else {
            0
        };
    let handle = unsafe {
        CreateFileW(
            name.as_ptr(),
            access,
            FILE_SHARE_READ | FILE_SHARE_WRITE | if directory { 0 } else { FILE_SHARE_DELETE },
            attributes,
            disposition,
            flags,
            null_mut(),
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        return Err(io::Error::last_os_error());
    }
    Ok(unsafe { File::from_raw_handle(handle) })
}

pub(crate) fn open_private_file(path: &Path, create: bool, exclusive: bool) -> io::Result<File> {
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "private file has no parent"))?;
    let name = path.file_name().ok_or_else(|| {
        io::Error::new(io::ErrorKind::InvalidInput, "private file has no file name")
    })?;
    open_private_directory(parent)?.open_file(name, create, exclusive)
}

fn open_relative_file(
    parent: &File,
    name: &OsStr,
    create: bool,
    exclusive: bool,
    delete_access: bool,
) -> io::Result<File> {
    let security = PrivateSecurity::new()?;
    let mut name = wide(name)?;
    name.pop();
    let unicode = UNICODE_STRING {
        Length: u16::try_from(name.len() * 2)
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "file name is too long"))?,
        MaximumLength: u16::try_from(name.len() * 2)
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "file name is too long"))?,
        Buffer: name.as_mut_ptr(),
    };
    let attributes = OBJECT_ATTRIBUTES {
        Length: std::mem::size_of::<OBJECT_ATTRIBUTES>() as u32,
        RootDirectory: parent.as_raw_handle(),
        ObjectName: &unicode,
        Attributes: 0x40,
        SecurityDescriptor: security.0.0.cast(),
        SecurityQualityOfService: null(),
    };
    let access = GENERIC_READ
        | if create { GENERIC_WRITE } else { 0 }
        | if delete_access { DELETE } else { 0 };
    let disposition = if exclusive {
        FILE_CREATE
    } else if create {
        FILE_OPEN_IF
    } else {
        FILE_OPEN
    };
    let mut handle = INVALID_HANDLE_VALUE;
    let mut status = windows_sys::Win32::System::IO::IO_STATUS_BLOCK::default();
    let result = unsafe {
        NtCreateFile(
            &mut handle,
            access | SYNCHRONIZE,
            &attributes,
            &mut status,
            null(),
            FILE_ATTRIBUTE_NORMAL,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            disposition,
            FILE_NON_DIRECTORY_FILE | FILE_OPEN_REPARSE_POINT | FILE_SYNCHRONOUS_IO_NONALERT,
            null(),
            0,
        )
    };
    if result < 0 {
        return Err(io::Error::from_raw_os_error(
            unsafe { RtlNtStatusToDosError(result) } as i32,
        ));
    }
    let file = unsafe { File::from_raw_handle(handle) };
    let metadata = file.metadata()?;
    if !metadata.is_file() || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "private file is not a regular file or is a reparse point",
        ));
    }
    validate_private_handle(&file)?;
    Ok(file)
}

pub(crate) fn lock(file: &File) -> io::Result<()> {
    let mut overlapped: OVERLAPPED = unsafe { std::mem::zeroed() };
    if unsafe {
        LockFileEx(
            file.as_raw_handle(),
            LOCKFILE_EXCLUSIVE_LOCK,
            0,
            1,
            0,
            &mut overlapped,
        )
    } == 0
    {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

pub(crate) fn remove_file(file: &File) -> io::Result<()> {
    let disposition = FILE_DISPOSITION_INFO { DeleteFile: true };
    if unsafe {
        SetFileInformationByHandle(
            file.as_raw_handle(),
            FileDispositionInfo,
            std::ptr::addr_of!(disposition).cast(),
            std::mem::size_of::<FILE_DISPOSITION_INFO>() as u32,
        )
    } == 0
    {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

fn replace_relative(parent: &File, source: &File, destination: &OsStr) -> io::Result<()> {
    let mut destination = wide(destination)?;
    destination.pop();
    let name_bytes = destination.len() * 2;
    let size = std::mem::offset_of!(FILE_RENAME_INFORMATION, FileName) + name_bytes;
    let mut buffer = vec![0usize; size.div_ceil(std::mem::size_of::<usize>())];
    let info = buffer.as_mut_ptr().cast::<FILE_RENAME_INFORMATION>();
    unsafe {
        (*info).Anonymous.ReplaceIfExists = true;
        (*info).RootDirectory = parent.as_raw_handle();
        (*info).FileNameLength = name_bytes as u32;
        std::ptr::copy_nonoverlapping(
            destination.as_ptr(),
            std::ptr::addr_of_mut!((*info).FileName).cast::<u16>(),
            destination.len(),
        );
    }
    let mut status = windows_sys::Win32::System::IO::IO_STATUS_BLOCK::default();
    let result = unsafe {
        NtSetInformationFile(
            source.as_raw_handle(),
            &mut status,
            info.cast(),
            size as u32,
            FileRenameInformation,
        )
    };
    if result < 0 {
        return Err(io::Error::from_raw_os_error(
            unsafe { RtlNtStatusToDosError(result) } as i32,
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn private_directory_handles_block_ancestor_replacement() {
        let temp = tempfile::tempdir().unwrap();
        let ancestor = temp.path().join("ancestor");
        let directory = open_private_directory(&ancestor.join("private")).unwrap();

        assert!(std::fs::rename(&ancestor, temp.path().join("moved")).is_err());
        directory
            .open_file(OsStr::new("credential.json"), true, true)
            .unwrap();
    }
}
