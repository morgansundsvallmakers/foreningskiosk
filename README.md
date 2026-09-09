# Föreningskiosken

En lokal webbapp för en enkel föreningskiosk. Backend körs med Node.js och använder SQLite. Frontend är byggd med Vue 3 och Vite.

## Funktioner

- kioskflöde för produkter, kundvagn och Swish-betalning
- flera Swish-mottagare med valbar standardmottagare
- startsida med länkar, nätverksadress och QR-kod
- administration av produkter, mottagare och PIN-kod
- statistik med export
- lokal SQLite-databas
- valfri föreningslogotyp som lagras lokalt vid databasen
- Windows-distribution som portable-paket och installer

## Krav för utveckling

- Node.js 24 eller senare
- pnpm

Installera beroenden:

```bash
pnpm install
```

Starta utvecklingsmiljön:

```bash
pnpm dev
```

Frontend körs då via Vite och backend startas separat av root-scriptet.

## Bygg och test

Bygg frontend:

```bash
pnpm build
```

Kör tester:

```bash
pnpm test
```

## Databas

Utvecklingsversionen använder som standard:

```text
data/foreningskiosken.db
```

Den katalogen finns i repot, men själva databasen ignoreras av Git.

Installerad Windows-version använder i stället:

```text
%LOCALAPPDATA%\Foreningskiosken\data\foreningskiosken.db
```

Det gör att databasen ligger kvar vid uppgradering eller ominstallation.

En ny databas innehåller inga fördefinierade Swish-mottagare och ingen mottagare är vald från början. Befintliga databaser behåller sina mottagare och ett giltigt tidigare val.

## Lokal logotyp

Från startsidan på serverdatorn kan en valfri föreningslogotyp väljas, bytas eller tas bort.

Stöd:

- PNG
- JPEG
- GIF
- högst 5 MB
- högst 8000 × 8000 pixlar

Logotypen lagras lokalt bredvid den permanenta databasen. Andra enheter på nätverket kan läsa och visa logotypen, men den får bara ändras eller tas bort från serverdatorn.

Föreningskiosken fungerar även utan logotyp.

## Windows portable

Bygg portable-versionen med:

```text
pnpm run dist:portable
```

Resultatet skrivs till:

```text
dist-portable\Foreningskiosken
```

Portable-paketet innehåller en egen Node-runtime och behöver därför ingen separat Node-installation på måldatorn.

Starta med:

```text
Starta-Foreningskiosken.cmd
```

Portable-versionen sätter `PORT=0`, vilket innebär att Windows väljer en ledig TCP-port vid varje start. Den faktiska porten används i de lokala och LAN-adresser som visas i terminalen och när `/start` öppnas automatiskt i webbläsaren.

Utvecklingsmiljön använder fortfarande port 3000 som standard, eftersom Vite-proxyn är konfigurerad för den fasta utvecklingsporten.

## Windows-brandvägg

Vid start kontrollerar distributionsskriptet Windows nätverksprofil.

- Om ett aktivt nätverk är markerat som **Privat** binder servern till `0.0.0.0`, så andra enheter på samma LAN kan nå kiosken.
- Om inget aktivt Privat nätverk finns binder servern till `127.0.0.1`, så endast serverdatorn kan nå den.
- Brandväggsreglerna är programspecifika för den medföljande `runtime\node.exe` och tillåter inkommande TCP på Privat profil oavsett vilken ledig port Windows väljer.
- Publik profil blockeras uttryckligen för samma körbara fil.
- Äldre Föreningskiosken-regler med port 3000 i namnet tas bort när konfigurationen körs, så uppgraderingar inte lämnar gamla regler kvar.

Det betyder att en upptagen port 3000 inte längre hindrar den installerade eller portable versionen från att starta.

## Windows installer

Bygg installer med:

```text
pnpm run dist:installer
```

Bygget skapar först portable-versionen och paketerar sedan den med Inno Setup.

Resultatet skrivs till:

```text
dist-installer\Foreningskiosken-Setup.exe
```

Byggskriptet letar efter Inno Setup i vanliga installationsmappar. Alternativt kan sökvägen anges med miljövariabeln `ISCC_PATH`.

Installerad version:

- lägger programfiler under `Program Files`
- skapar genväg i Start-menyn
- använder den permanenta databasen under `%LOCALAPPDATA%`
- konfigurerar brandväggen med programspecifika TCP-regler för Privat/Public profil
- använder en automatiskt vald ledig TCP-port vid varje start
- öppnar `/start` automatiskt i webbläsaren

## Startvy

Startsidan finns på:

```text
http://localhost:<vald-port>/start
```

Där visas bland annat:

- länk till kiosken
- LAN-adress för andra enheter
- QR-kod till LAN-adressen
- administrativ åtkomst
- statistik
- valfri lokal föreningslogotyp

Eftersom installerad och portable version väljer port dynamiskt är den automatiskt öppnade startsidan det enklaste sättet att hitta aktuell adress.

## Projektstruktur

```text
frontend/                 Vue/Vite-klient
data/                     lokal utvecklingsdatabas (ignoreras av Git)
server/                   Node-backend
distribution/             Windows-build, brandvägg och installer
```

## Säkerhet

Föreningskiosken är avsedd för ett betrott lokalt nätverk och ska inte exponeras direkt mot internet.

## Licens

Föreningskiosken distribueras under MIT License. Se `LICENSE`.
