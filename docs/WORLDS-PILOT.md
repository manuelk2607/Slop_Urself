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
  und für Logout-Signale `/auth/backchannel-logout`. Die Node-Routen setzen
  eine vertrauenswürdige HTTPS-Eingangsschicht voraus. Der Pilot wird auf
  einem separaten Cloudflare-Worker abgenommen.
- `/auth/worlds` startet den Login. Die Verknüpfung verlangt die aktive
  lokale Sitzung, das aktuelle Passwort, frisches signiertes `auth_time`
  und eine ausdrückliche Bestätigung mit CSRF-Schutz. Profile ohne Passwort
  und das Administrationskonto sind im Pilot ausgenommen.
- Die SQL-Transaktion prüft nochmals Sitzung, Ablauf und Passwortversion.
  Zuordnung und Audit schreiben gemeinsam. Das Mapping referenziert die
  vorhandene lokale ID, die auch HF-Anbindung, Kontingente und Jobs verwenden.

`WORLDS_REAUTH_ENABLED` bleibt bis zur Abnahme mit dem echten Anbieter
ausgeschaltet. Die Pilotzuordnung wird bisher nur auf der Pilotseite angezeigt.
Vor Aktivierung folgen die Zuordnung zur HTTP- und WebSocket-Spielersitzung,
eine Abmelde- und Widerrufsprüfung für beide Laufzeiten, begrenzte Bereinigung
abgelaufener Sitzungen sowie eine erneute Prüfung der HF- und Moderationsgrenzen
mit verknüpfter Anmeldung.

Lokale Abnahme am 5. November 2026. Ein signierter Testanbieter lieferte
Ed25519-ID-Tokens und bestätigte PKCE, Callback-Bindung und Replay-Schutz.
PGlite bestätigte die atomische Zuordnung, auch bei gleichzeitiger Bestätigung,
Passwortwechsel und Sitzungswiderruf. Der workerd-Test prüfte den bestehenden
persönlichen HF-Device-/OAuth-Ablauf, die Einzelkontingente und Abmeldung mit
Testantworten. 147 Tests, Node-/Worker-Typprüfung und Build, Node-Start und
Worker-Trockenlauf bestanden. Der bestehende Produktionsaudit meldete sechs
Befunde auf Basis und Featurebranch mit derselben Paketliste.
