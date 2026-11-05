# Worlds-Pilot für Slop Urself

Der Pilot auf `feature/worlds-hub-sso` verwendet den OIDC-Codeflow mit PKCE
aus Worlds Hub. Die Dateien in `src/auth/worlds-shared/` stammen unverändert
aus `packages/auth/` in Worlds Hub, Revision `049279b`.

- Standardmäßig antworten die privaten Pilotrouten mit 404. Das Flag
  `WORLDS_PILOT_ENABLED=true` erfordert eine exakte separate HTTPS-Origin
  und einen passenden `WORLDS_PILOT_DATABASE_HOST`. Der produktive Worker
  und sein Neon-Endpunkt einschließlich Pooler werden abgewiesen.
- Das additive Schema wird ausschließlich mit `npm run worlds:schema` im
  ausdrücklich konfigurierten Testziel installiert. `DATABASE_URL` gehört
  in die Geheimnisverwaltung des Testziels. Das Skript gibt die Verbindung
  bei Fehlern nicht aus.
- Der isolierte Client benötigt `WORLDS_ISSUER`, `WORLDS_CLIENT_ID` und
  `WORLDS_RESOURCE`, einen beim Anbieter registrierten `/auth/callback`
  und für Logout-Signale `/auth/backchannel-logout`. Node unterstützt einen
  lokalen HTTPS-Reverse-Proxy mit `WORLDS_TRUST_LOOPBACK_PROXY=true`. Der Proxy
  setzt Host und Protokoll selbst und überschreibt eingehende Forwarded-Header.
  Für Cloudflare steht `cloudflare/wrangler.worlds-pilot.toml` bereit. Der
  Worker `slopurself-worlds-pilot` verlangt das isolierte Datenbankziel und
  nutzt simulierte Videos. Seine Seiten und Assets sind von der Indexierung
  ausgeschlossen. Den Pilot-Client mit exakt
  `https://slopurself-worlds-pilot.maki26.workers.dev/auth/callback` beim
  Anbieter und in der Consent-Registry des Hubs registrieren. Den Pilot erst
  nach Einrichtung des Testziels, der Secrets und des Clients aktivieren.
  Die Konfiguration lässt sich mit `npm run build` und
  `npx wrangler deploy --dry-run --config cloudflare/wrangler.worlds-pilot.toml`
  prüfen.
- `/auth/worlds` startet den Login. Die Verknüpfung verlangt die aktive
  lokale Sitzung, das aktuelle Passwort, frisches signiertes `auth_time`
  und eine ausdrückliche Bestätigung mit CSRF-Schutz. Profile ohne Passwort
  und das Administrationskonto sind im Pilot ausgenommen.
- Die SQL-Transaktion prüft nochmals Sitzung, Ablauf und Passwortversion.
  Zuordnung und Audit schreiben gemeinsam. Das Mapping referenziert die
  vorhandene lokale ID, die auch HF-Anbindung, Kontingente und Jobs verwenden.

`WORLDS_REAUTH_ENABLED` bleibt bis zur Abnahme mit dem echten Anbieter
ausgeschaltet. Die HTTP- und WebSocket-Spielersitzungen verwenden die lokale
ID aus dem Mapping. Bei bereits aktiver lokaler Anmeldung entscheidet der
Benutzer über den Wechsel. Es wird kein Worlds- oder HF-Token an das Spielskript
ausgegeben. Jede Spielaktion prüft die Gültigkeit der Sitzung. Passwortwechsel,
Profilverlust und Abmeldung beenden die betroffenen Spielersitzungen. Die
persönliche HF-Verbindung bleibt an dieselbe lokale ID gebunden und muss
separat gültig sein. Node und die separate Cloudflare-Konfiguration bereinigen
stündlich bis zu 250 abgelaufene Transaktionen, Sitzungen und Replay-Einträge
je Tabelle. Die echte Abnahme setzt die Cloudflare-Anmeldung, das isolierte
Datenbankziel und den registrierten Pilot-Client voraus.

Lokale Abnahme am 5. November 2026. Ein signierter Testanbieter lieferte
Ed25519-ID-Tokens und bestätigte PKCE, Callback-Bindung und Replay-Schutz.
PGlite bestätigte die atomische Zuordnung, auch bei gleichzeitiger Bestätigung,
Passwortwechsel und Sitzungswiderruf. Der workerd-Test prüfte den bestehenden
persönlichen HF-Device-/OAuth-Ablauf, die Einzelkontingente und Abmeldung mit
Testantworten. 147 Tests, Node-/Worker-Typprüfung und Build, Node-Start und
Worker-Trockenlauf bestanden. Der bestehende Produktionsaudit meldete sechs
Befunde auf Basis und Featurebranch mit derselben Paketliste.

Der nachfolgende workerd-Test bestätigte die lokale Profil-ID über die HTTP-API,
den HF-Pflichtdialog über einen echten lokalen WebSocket und die Sperre derselben
Verbindung nach Logout. Auch ein gültiger lokaler Spieltoken kann die
Widerrufsprüfung einer Worlds-Verbindung nicht ersetzen. Der PostgreSQL-Test
prüfte die separate HF-Verbindung, den Schutz vor fremden HF-Verbindungen und
den ausstehenden HF-Codeaustausch nach Logout. Alle externen Antworten in diesen
Tests stammen aus Fixtures.

Der Node-Test mit lokalem PostgreSQL 17 prüfte den Login mit den Headern des
lokalen HTTPS-Proxys, die HF-Sperre über Socket.IO, den Widerruf nach Logout
und die begrenzte Bereinigung einschließlich gültiger Sitzungen. Build,
Pilot-Trockenlauf, 148 Unit-Tests und beide workerd-Integrationen bestanden.
