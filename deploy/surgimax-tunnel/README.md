# surgimax-hospital.dvaic.com

The HMIS runs on a PC at the hospital. That PC keeps a reverse SSH tunnel
open to jh-lims (35.154.15.135), and nginx there serves the public site.

    browser ─https─▶ jh-lims nginx ─▶ 127.0.0.1:7060 ═ssh tunnel═▶ hospital PC :5011

## Server (already set up)
- User `surgimaxtunnel`: no shell, key may only open 127.0.0.1:7060
  (`authorized_keys`: `restrict,port-forwarding,permitlisten="127.0.0.1:7060",command="/bin/false" <key>`).
- `sshd-71-surgimaxtunnel.conf` → `/etc/ssh/sshd_config.d/`
- `nginx-surgimax-hospital.conf` → `/etc/nginx/sites-available/` (TLS by certbot).
- With the PC offline the site answers 503 "system is offline".

## Hospital PC
1. Put the private key at `C:\surgimax\surgimax_tunnel` (never commit it).
2. Backend `.env`:
   ```
   NODE_ENV=production
   ALLOWED_ORIGINS=https://surgimax-hospital.dvaic.com
   ALLOWED_HOSTS=surgimax-hospital.dvaic.com
   FRONTEND_URL=https://surgimax-hospital.dvaic.com
   QUICK_ACCESS=false
   ```
3. Run `start-tunnel.ps1` at startup (Task Scheduler, "Run whether user is logged on or not").
