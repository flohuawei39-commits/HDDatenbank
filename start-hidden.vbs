' Startet den HDDatenbank-Server ohne sichtbares Fenster und oeffnet danach das Dashboard.
' Wird von der Aufgabenplanung beim Anmelden aufgerufen.

Option Explicit

Dim shell, fso, ordner, port
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

ordner = fso.GetParentFolderName(WScript.ScriptFullName)
port = "8790"

shell.CurrentDirectory = ordner
' 0 = kein Fenster, False = nicht auf das Ende warten
shell.Run "cmd /c node """ & ordner & "\server.js""", 0, False

' Kurz warten, bis der Server lauscht, dann die Oberflaeche oeffnen.
WScript.Sleep 1800
shell.Run "http://127.0.0.1:" & port & "/", 1, False
