Option Explicit
Dim fileSystem, shell, directory, productName, executable, pending
Set fileSystem = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
directory = fileSystem.GetParentFolderName(WScript.ScriptFullName)
productName = ChrW(&H6CAB) & ChrW(&H9C7C)
executable = fileSystem.BuildPath(directory, productName & ".exe")
pending = fileSystem.BuildPath(directory, productName & ".next.exe")
If fileSystem.FileExists(pending) Then
  On Error Resume Next
  fileSystem.CopyFile pending, executable, True
  If Err.Number = 0 Then fileSystem.DeleteFile pending, True
  Err.Clear
  On Error GoTo 0
End If
shell.CurrentDirectory = directory
shell.Run Chr(34) & executable & Chr(34), 1, False
