# Bibliotek – webbapp med synk

Ett gemensamt bibliotek för två personer. Appen fungerar på Android, iPhone och dator, synkar automatiskt mellan era telefoner och går att installera på hemskärmen.

**Funktioner:**
- Google-inloggning
- Läst/Oläst
- Taggar
- Sortering på författare (fällbar) eller titel
- Sökning
- Goodreads-länkar
- Excel-import och -export
- Ljust/mörkt tema
- Fungerar offline (ändringar synkas när nätet kommer tillbaka)

**Streckkodsskanning:** med kameran i Chrome på Android. På iPhone skriver du in ISBN-numret, och författare och titel hämtas automatiskt.

**Kostnad:** 0 kr. Firebase gratisnivå (Spark, inget betalkort) och GitHub Pages.

---

## Installation (cirka 20 minuter, görs en gång)

### 1. Skapa ett Firebase-projekt
1. Gå till <https://console.firebase.google.com> och logga in med ditt Google-konto.
2. Välj **Skapa projekt** (Create project) och ge det ett namn, t.ex. `bibliotek`. Google Analytics behövs inte.

### 2. Slå på Google-inloggning
1. Välj **Build → Authentication → Kom igång** (Get started).
2. Under **Sign-in method**: välj **Google**, slå på det, välj en support-e-post och spara.

### 3. Skapa databasen
1. Välj **Build → Firestore Database → Skapa databas** (Create database).
2. Välj en plats i Europa, t.ex. `eur3 (Europe)`.
3. Välj **Produktionsläge** (production mode). Använd inte testläge, det öppnar databasen för alla.
4. Öppna fliken **Regler** (Rules).
5. Öppna filen `firestore.rules` och byt de två e-postadresserna mot er två Google-adresser, med små bokstäver.
6. Klistra in hela filen i fältet i konsolen och tryck **Publicera** (Publish).

### 4. Koppla appen till Firebase
1. Öppna **Projektinställningar** (kugghjulet). Under **Dina appar**: välj webbikonen **</>**, ge appen ett namn och registrera den. Firebase Hosting behövs inte.
2. Kopiera värdena i `firebaseConfig` (apiKey, authDomain, projectId osv.).
3. Klistra in dem i filen `firebase-config.js`.

### 5. Publicera appen på GitHub Pages
1. Skapa ett nytt repository på GitHub, t.ex. `bibliotek-webb`, och ladda upp alla filer i den här mappen. Ladda inte upp din boklista (Excel-filen), eftersom repot är publikt.
2. Öppna **Settings → Pages** i repot. Under **Source** väljer du **Deploy from a branch**, sedan `main` och `/ (root)`, och sparar.
3. Efter någon minut finns appen på `https://DITT-ANVÄNDARNAMN.github.io/bibliotek-webb/`.

GitHub Pages kräver ett **publikt** repository på GitHubs gratisplan. Det är ingen säkerhetsrisk: koden och Firebase-konfigurationen är inte hemliga, och böckerna ligger i databasen, som bara ni två kommer åt.

### 6. Godkänn adressen för inloggning
I Firebase-konsolen: välj **Authentication → Settings → Authorized domains → Add domain** och lägg till `DITT-ANVÄNDARNAMN.github.io`.

### 7. Installera på telefonerna
- **Android (Chrome):** öppna adressen, logga in och välj menyn ⋮ → **Installera app** (eller Lägg till på startskärmen).
- **iPhone (Safari):** öppna adressen, tryck på dela-knappen och välj **Lägg till på hemskärmen**. Öppna appen från hemskärmen och logga in där. Hemskärmsappen har en egen inloggning, skild från Safari.

### 8. Fyll biblioteket
Logga in, välj ⋮ → **Importera Excel** och välj `Bokhylla.xlsx`. Ange taggen *Skönlitteratur*. Böckerna syns direkt på den andra telefonen.

---

## Säkerhet

- **Inloggning:** sköts helt av Google. Appen ser aldrig era lösenord, och tvåstegsverifiering på Google-kontot gäller som vanligt.
- **Behörighet:** databasreglerna släpper bara in de två adresserna i `firestore.rules`. Den som loggar in med ett annat konto får ett felmeddelande och ser inga böcker. Reglerna kontrollerar också att data har rätt form och storlek.
- **Konfigurationen är inte hemlig:** `apiKey` i `firebase-config.js` identifierar bara projektet. Det är normalt att den syns. Skyddet ligger i reglerna.
- **Den verkliga risken** är att databasen öppnas av misstag. Använd aldrig testläge och ta inte bort `allowed()`-kontrollen i reglerna.
- **Säkerhetskopia:** exportera till Excel då och då.

## Om något strular

- **Inloggningsfönstret stängs eller fastnar på iPhone:** prova i Safari först, utanför hemskärmsappen. Fungerar det inte går appen att flytta till Firebase Hosting, där inloggningen sker utan popup-fönster.
- **"Kontot har inte behörighet":** kontrollera att adressen står exakt rätt (små bokstäver) i reglerna och att du har tryckt Publicera.
- **Uppdatera appen:** ladda upp de nya filerna till GitHub. Telefonerna hämtar den nya versionen nästa gång appen öppnas med nät.
