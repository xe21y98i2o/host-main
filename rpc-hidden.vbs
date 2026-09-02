Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\Users\1337\Documents\vc-keepalive"
WshShell.Run "cmd /c node rpc-client.js > rpc-log.txt 2>&1", 0, False
