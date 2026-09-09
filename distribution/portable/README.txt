FÖRENINGSKIOSKEN – PORTABEL WINDOWS-VERSION
===========================================

STARTA
1. Packa upp hela mappen på kiosk-PC:n.
2. Dubbelklicka på "Starta Föreningskiosken.cmd".
3. Första gången visar Windows en kontrollfråga. Välj Ja. Programmet skapar då
   programspecifika brandväggsregler som tillåter den medföljande node.exe på
   privata nätverk och blockerar den på publika nätverk.
4. Låt serverfönstret vara öppet medan kiosken används.
5. Den lokala startsidan öppnas automatiskt på en ledig port som Windows väljer.

På startsidan sätter eller ändrar operatören Admin-PIN och ser adressen till
surfplattan. Startsidan och nätverksinformationen kan bara öppnas på kiosk-PC:n.
Surfplattan och kiosk-PC:n måste vara anslutna till samma betrodda privata
nätverk.

VYER
- Kiosk: försäljning och lokalt genererad Swish-QR för aktuellt belopp.
- Admin: produkter och Swish-mottagare, skyddat med Admin-PIN/session.
- Statistik: dagens försäljning och CSV-export, skyddat med adminsession.
- Start: lokal konfiguration och nätverksstatus på kiosk-PC:n.

Swish-QR skapas dynamiskt i webbläsaren. Distributionen innehåller inga gamla
statiska Swish-QR-bilder och behöver ingen extern webbresurs i normal drift.

STOPPA
Stäng serverfönstret eller tryck Ctrl+C i det. Kiosken slutar då att svara.

DATA
Försäljningsdata sparas separat här:
%LOCALAPPDATA%\Foreningskiosken\data\foreningskiosken.db

Databasen följer därför inte med när programmappen kopieras, ersätts eller
tas bort. Den bevaras också vid uppgradering. Säkerhetskopiera filen ovan när
Föreningskiosken inte körs.

BRANDVÄGG OCH NÄTVERK
Startfilen konfigurerar automatiskt en specifik inkommande Allow-regel för den
medföljande node.exe på profilen Privat. En uttrycklig Block-regel för samma
program på profilen Publik hindrar åtkomst via publika nätverk. Serverporten
väljs automatiskt vid varje start, så en redan upptagen port hindrar inte start.

Om inget aktivt Privat nätverk finns lyssnar servern bara på den egna datorn.
Byt bara nätverksprofil till Privat om det verkligen är ett betrott klubb-
eller hemnätverk. Programmet ändrar aldrig nätverksprofilen automatiskt.

FELSÖKNING
- Kontrollera att serverfönstret fortfarande är öppet.
- Kontrollera att båda enheterna använder samma privata nätverk.
- Använd adressen som öppnas automatiskt eller visas på startsidan; porten kan
  vara olika mellan starter.

Node.js, npm och pnpm behöver inte installeras av slutanvändaren. All normal
drift är lokal och fungerar utan internetanslutning.
