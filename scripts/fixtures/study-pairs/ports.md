# Ports to memorize (Core 1 2.1)

| Port | Protocol | TCP/UDP | What for |
|---|---|---|---|
| 20/21 | FTP | TCP | file transfer (20 data, 21 control) |
| 22 | SSH | TCP | secure remote shell, also SFTP |
| 23 | Telnet | TCP | old insecure remote terminal |
| 25 | SMTP | TCP | sending email |
| 53 | DNS | TCP/UDP | name -> IP |
| 67/68 | DHCP | UDP | auto IP addressing (67 server, 68 client) |
| 80 | HTTP | TCP | web |
| 110 | POP3 | TCP | download email |
| 137-139 | NetBIOS/NetBT | TCP/UDP | old Windows name/file sharing |
| 143 | IMAP | TCP | email synced on server |
| 161/162 | SNMP | UDP | network monitoring (162 = traps) |
| 389 | LDAP | TCP/UDP | directory (Active Directory) |
| 443 | HTTPS | TCP | secure web |
| 445 | SMB/CIFS | TCP | Windows file sharing |
| 3389 | RDP | TCP | Remote Desktop |

tricks: SSH 22 vs Telnet 23 ("tele is one more"), RDP 3389 is the weird long one.
