NUMERO VAULT
Secure document store with user logins and per-user access levels.

WHAT YOU NEED
  Node.js 18 or newer (https://nodejs.org). Nothing else: there are no packages to install.

START IT
  Windows:  double-click start.bat        (or: node server.js)
  Linux:    ./start.sh                    (or: node server.js)
  Then open  http://localhost:8080  on the server, or  http://<server-ip>:8080  from other computers.

FIRST SIGN-IN
  The first start creates the user "admin" with a random password. It is printed in the
  console window and saved in  data/FIRST-LOGIN.txt . Sign in, choose your own password,
  then delete that file. Create the other users on the People tab.

SETTINGS (environment variables, all optional)
  PORT      port number, default 8080
  DATA_DIR  where everything is stored, default the "data" folder beside server.js
  HOST      network address to listen on, default 0.0.0.0 (all)
  Example (Linux):    PORT=80 DATA_DIR=/srv/vault-data node server.js
  Example (Windows):  set PORT=80 && set DATA_DIR=D:\VaultData && node server.js

STORAGE
  Files are written to DATA_DIR/files on the server's own disk. There is no limit on the
  number of files or on file size other than the free space on that disk. Point DATA_DIR
  at your largest drive. Every earlier version of an edited file is kept until the file
  is deleted for good.

BACK UP
  Copy the whole DATA_DIR folder. It holds:
    files/        the stored documents
    db.json       users, groups, folders, permissions (passwords are stored hashed)
    audit.jsonl   the audit log
  A dated copy of db.json is made every day and kept for 14 days.

DOCUMENT VIEWERS WITHOUT INTERNET
  PDF, Word, Excel and PowerPoint previews use five small viewer scripts. By default the
  browser fetches them from the internet. For an office network without internet, run this
  once on a computer that has internet, in this folder:
      node get-libs.js
  It saves them into public/vendor and the vault then needs no internet at all.

LIVE MONITORING (admins)
  The Live menu shows who is signed in right now, whether they are active or idle, the
  page or file they have open, their network address and browser. "Watch" opens the same
  file and follows how far the person has scrolled. "Sign out" ends all of that person's
  sessions at once. Each Watch and Sign out is written to the audit log.
  This covers what the person does inside Numero Vault. It cannot see other windows or
  programs on their computer. Users are told on the sign-in page and in the menu that
  their activity is recorded and can be watched live.

KEEP IT RUNNING
  Windows: install it as a service with NSSM (nssm install NumeroVault "C:\Program Files\nodejs\node.exe" "C:\NumeroVault\server.js")
           or add start.bat to Task Scheduler "At startup".
  Linux:   use systemd, or  npm install -g pm2 && pm2 start server.js --name numero-vault && pm2 save

SECURITY NOTES
  - The server speaks plain HTTP. Inside an office network that is normal. If people will
    reach it over the internet, put it behind HTTPS (IIS, Nginx or Caddy as a reverse proxy)
    so passwords and files are encrypted in transit.
  - Every permission is checked on the server. A user never receives a file, or even its
    name, unless it has been granted to them.
  - "View only" stops downloading, copying and right-click in the app, and previews carry
    the viewer's name as a watermark. It cannot stop screenshots or a photo of the screen.
  - Keep at least two admin accounts. If the only admin forgets their password it cannot
    be reset from the app; you would have to restore db.json from a backup.
  - Deleted files stay in the recycle bin for 30 days, then are removed from disk.
