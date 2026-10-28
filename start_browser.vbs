Option Explicit
Dim fileSystem, shell, root, runtime, application, portable, productName, portableLauncher
Set fileSystem = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
root = fileSystem.GetParentFolderName(WScript.ScriptFullName)
productName = ChrW(&H6CAB) & ChrW(&H9C7C)
portable = fileSystem.BuildPath(root, "dist\" & productName & "-win32-x64\" & productName & ".exe")
portableLauncher = fileSystem.BuildPath(fileSystem.GetParentFolderName(portable), "start.vbs")
runtime = fileSystem.BuildPath(root, "node_modules\electron\dist\electron.exe")
application = root
If fileSystem.FileExists(portable) Then
  shell.CurrentDirectory = fileSystem.GetParentFolderName(portable)
  If fileSystem.FileExists(portableLauncher) Then
    shell.Run "wscript.exe " & Chr(34) & portableLauncher & Chr(34), 0, False
  Else
    shell.Run Chr(34) & portable & Chr(34), 1, False
  End If
ElseIf fileSystem.FileExists(runtime) Then
  shell.CurrentDirectory = application
  shell.Run Chr(34) & runtime & Chr(34) & " " & Chr(34) & application & Chr(34), 1, False
Else
  MsgBox "Please run install_browser.bat first.", 48, productName & " - MoYu"
End If
