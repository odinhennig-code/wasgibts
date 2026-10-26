/* =========================================================================
   WAS GIBT'S? – Rechtstexte (Impressum, Datenschutz, Nutzungsbedingungen,
   Haftungsausschluss). Werden in der App und auf rechtliches.html genutzt.
   Stand: 26. Oktober 2026

   WICHTIG vor der öffentlichen Veröffentlichung:
   – Anschrift und E-Mail im Impressum eintragen (Platzhalter in [eckigen Klammern]).
   – Die Texte sind eine sorgfältige Vorlage, ersetzen aber keine Rechtsberatung.
   ========================================================================= */
const STAND = '26. Oktober 2026';
const OWNER = 'Odin Hennig';
const ADDRESS = '[Straße und Hausnummer]<br>[PLZ und Ort]<br>Deutschland';
const MAIL = '[E-Mail-Adresse]';
const todo = '<p class="legal-todo">⚠️ Anschrift und E-Mail-Adresse werden vor der öffentlichen Veröffentlichung ergänzt.</p>';

export const LEGAL = {
  impressum: ['Impressum', `${todo}
    <h3>Angaben gemäß § 5 DDG</h3>
    <p>${OWNER}<br>${ADDRESS}</p>
    <h3>Kontakt</h3>
    <p>E-Mail: ${MAIL}<br>Oder direkt in der App unter „Mehr → Feedback senden".</p>
    <h3>Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV</h3>
    <p>${OWNER}, Anschrift wie oben</p>
    <h3>Verbraucherstreitbeilegung</h3>
    <p>Wir sind nicht bereit und nicht verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.</p>
    <h3>Bildnachweise</h3>
    <p>Rezeptfotos: Pexels (pexels.com), Fotograf jeweils am Bild genannt. Symbole: Emojis und eigene Grafiken.</p>
    <p class="legal-stand">Stand: ${STAND}</p>`],

  privacy: ['Datenschutzerklärung', `
    <p>Der Schutz deiner Daten ist uns wichtig. Hier erklären wir verständlich, welche Daten „Was gibt's?" verarbeitet, warum, wie lange und welche Rechte du hast.</p>

    <h3>1. Verantwortlicher</h3>
    <p>${OWNER}, ${ADDRESS.replace(/<br>/g, ', ')}<br>E-Mail: ${MAIL}</p>
    <p>Einen Datenschutzbeauftragten müssen wir nicht benennen. Bei Fragen wende dich direkt an uns.</p>

    <h3>2. Was wir verarbeiten und warum</h3>
    <p><b>Konto:</b> E-Mail-Adresse und Passwort (nur verschlüsselt gespeichert), Name und Profilbild-Emoji. Zweck: Anmeldung und Nutzung der App. Rechtsgrundlage: Vertrag (Art. 6 Abs. 1 lit. b DSGVO).</p>
    <p><b>Familie und Inhalte:</b> Familienname und -code, Mitgliedschaften, Kühlschrank-Inhalt mit Haltbarkeitsdaten, Einkaufsliste, Wochenplan, Wünsche, Lieblingsgerichte, Abstimmungen und eigene Rezepte. Diese Daten sehen nur die Mitglieder deiner Familie. Rechtsgrundlage: Vertrag (Art. 6 Abs. 1 lit. b DSGVO).</p>
    <p><b>Essensvorlieben, Unverträglichkeiten und „vegetarisch":</b> Damit die App passende Gerichte vorschlägt. Angaben zu Unverträglichkeiten (z. B. Laktose, Gluten, Nüsse) können Gesundheitsdaten sein. Sie sind freiwillig, werden nur dafür genutzt und nur deiner Familie angezeigt. Rechtsgrundlage: deine ausdrückliche Einwilligung durch das Eintragen (Art. 9 Abs. 2 lit. a DSGVO). Du kannst sie jederzeit im Profil löschen.</p>
    <p><b>Nutzungsangaben:</b> Zeitpunkt der letzten Nutzung (höchstens alle paar Stunden aktualisiert) und die App-Version. Zweck: Betrieb, Fehlersuche und einfache Statistiken für den Betreiber. Rechtsgrundlage: berechtigtes Interesse an einem funktionierenden Dienst (Art. 6 Abs. 1 lit. f DSGVO).</p>
    <p><b>Feedback und Fehlerberichte:</b> Was du über „Feedback senden" schreibst, und automatische Fehlerberichte, wenn z. B. die Foto-Erkennung fehlschlägt (Fehlertext, App-Version, dein Konto). Rechtsgrundlage: berechtigtes Interesse (Art. 6 Abs. 1 lit. f DSGVO).</p>
    <p><b>Interesse an „Plus":</b> Wenn du „Ich hätte Interesse" tippst, speichern wir das, um dich beim Start zu informieren. Rechtsgrundlage: Einwilligung (Art. 6 Abs. 1 lit. a DSGVO).</p>

    <h3>3. Fotos und Künstliche Intelligenz</h3>
    <p>Wenn du den Kühlschrank oder ein Haltbarkeitsdatum fotografierst, wird das Foto verkleinert an unseren Server und von dort an <b>Google (Gemini API, Google LLC, USA)</b> gesendet, um Zutaten bzw. Datum und Produkt zu erkennen. Wir speichern das Foto nicht.</p>
    <p>Für ausführliche Kochschritte und die Auswahl von Rezeptfotos senden wir nur den Rezeptnamen und die Zutaten an Google – keine Daten über dich.</p>
    <p><b>Wichtig:</b> Wir nutzen derzeit den kostenlosen Zugang von Google. Nach den Bedingungen von Google können Inhalte, die über den kostenlosen Zugang gesendet werden, von Google zur Verbesserung seiner Dienste verwendet und dabei auch von Menschen geprüft werden. <b>Fotografiere deshalb nur Lebensmittel – keine Personen, Dokumente oder andere persönliche Dinge.</b></p>
    <p>Falls Google gerade nicht erreichbar ist, kann ersatzweise OpenRouter (OpenRouter Inc., USA) genutzt werden. Rechtsgrundlage: Vertrag (Art. 6 Abs. 1 lit. b DSGVO), denn du startest die Erkennung selbst.</p>

    <h3>4. Push-Benachrichtigungen</h3>
    <p>Nur wenn du sie unter „Mehr" einschaltest und dein Gerät es erlaubt. Dafür speichern wir eine technische Adresse deines Geräts. Zugestellt werden die Nachrichten über den Dienst deines Geräteherstellers bzw. Browsers (z. B. Apple, Google oder Mozilla). Wir senden Neuigkeiten zur App und Familien-Hinweise (z. B. neuer Wunsch, Abstimmung, Beitrittsanfrage). Rechtsgrundlage: Einwilligung (Art. 6 Abs. 1 lit. a DSGVO). Du kannst sie jederzeit in der App oder in den Geräte-Einstellungen ausschalten. Beim Abmelden wird die Adresse gelöscht.</p>

    <h3>5. Sprachsteuerung und Vorlesen</h3>
    <p>Nur wenn du im Kochmodus das Mikrofon einschaltest. Die Spracherkennung übernimmt dein Browser bzw. Betriebssystem; je nach Gerät wird die Sprache dafür an den Anbieter gesendet (z. B. Google bei Chrome, Apple bei Safari). Wir erhalten und speichern keine Aufnahmen. Rechtsgrundlage: Einwilligung (Art. 6 Abs. 1 lit. a DSGVO) durch das Einschalten.</p>

    <h3>6. Kamera und Mikrofon</h3>
    <p>Die App greift nur darauf zu, wenn du selbst ein Foto machst oder die Sprachsteuerung startest, und nur nach Erlaubnis durch dein Gerät.</p>

    <h3>7. Speicherung auf deinem Gerät</h3>
    <p>Wir setzen keine Cookies zu Werbe- oder Analysezwecken und nutzen kein Tracking. Auf deinem Gerät (Local Storage / Service Worker) speichern wir nur, was für die App nötig ist: deine Anmeldung, Einstellungen wie Farbschema oder wer mitisst, zuletzt benutzte Zutaten sowie zwischengespeicherte Rezeptfotos und Kochschritte, damit die App schnell ist und auch offline startet. Rechtsgrundlage: § 25 Abs. 2 Nr. 2 TDDDG (unbedingt erforderlich).</p>

    <h3>8. Dienstleister und Empfänger</h3>
    <p><b>Supabase</b> (Supabase Inc., USA): Datenbank, Anmeldung und Server-Funktionen. Die Daten liegen in einem Rechenzentrum in der EU. Mit Supabase besteht ein Auftragsverarbeitungsvertrag.</p>
    <p><b>GitHub Pages</b> (GitHub Inc., USA): liefert die App aus. Dabei werden technisch nötige Daten wie IP-Adresse und Zeitpunkt verarbeitet.</p>
    <p><b>jsDelivr</b>: liefert eine Programmbibliothek aus (Verbindung mit deiner IP-Adresse).</p>
    <p><b>Pexels</b> (pexels.com): Rezeptfotos werden direkt von deren Servern geladen; dabei wird deine IP-Adresse übertragen.</p>
    <p><b>Google</b> und ggf. <b>OpenRouter</b>: siehe Abschnitt 3. <b>Apple, Google, Mozilla</b>: siehe Abschnitt 4 und 5.</p>
    <p>Der Betreiber kann zur Betreuung der App Name, E-Mail, Familie, Registrierungsdatum, letzte Nutzung und Feedback einsehen und Konten bei Missbrauch sperren. Eine Weitergabe an andere Dritte oder ein Verkauf deiner Daten findet nicht statt.</p>

    <h3>9. Übermittlung in Drittländer</h3>
    <p>Einige Dienstleister sitzen in den USA. Die Übermittlung erfolgt auf Grundlage eines Angemessenheitsbeschlusses der EU-Kommission (EU-US Data Privacy Framework), soweit der Anbieter zertifiziert ist, oder auf Grundlage von EU-Standardvertragsklauseln (Art. 46 DSGVO).</p>

    <h3>10. Wie lange wir speichern</h3>
    <p>Kontodaten und Inhalte, bis du dein Konto löschst. Was du selbst löschst (z. B. Einträge der Einkaufsliste), ist sofort weg. Technische Protokolle zum Schutz vor Spam werden nach 30 Tagen gelöscht, Protokolle gesendeter Benachrichtigungen nach 12 Monaten. Fotos zur Erkennung werden nicht gespeichert. Gesetzliche Aufbewahrungspflichten bleiben unberührt.</p>

    <h3>11. Deine Rechte</h3>
    <p>Du hast das Recht auf Auskunft (Art. 15), Berichtigung (Art. 16), Löschung (Art. 17), Einschränkung der Verarbeitung (Art. 18), Datenübertragbarkeit (Art. 20) und Widerspruch gegen Verarbeitungen auf Grundlage berechtigter Interessen (Art. 21 DSGVO). Eine Einwilligung kannst du jederzeit mit Wirkung für die Zukunft widerrufen.</p>
    <p>In der App geht das direkt unter <b>„Mehr → Konto"</b>: <b>„Meine Daten herunterladen"</b> (Auskunft und Übertragbarkeit) und <b>„Konto löschen"</b>. Für alles andere schreib uns an ${MAIL}.</p>
    <p>Du hast außerdem das Recht, dich bei einer Datenschutz-Aufsichtsbehörde zu beschweren, z. B. bei der Behörde deines Bundeslandes.</p>

    <h3>12. Kinder und Jugendliche</h3>
    <p>„Was gibt's?" ist eine Familien-App. Wer jünger als 16 Jahre ist, darf ein Konto nur mit Zustimmung der Eltern anlegen.</p>

    <h3>13. Keine automatisierten Entscheidungen</h3>
    <p>Die Essensvorschläge sind Empfehlungen. Es findet keine automatisierte Entscheidung mit rechtlicher Wirkung im Sinne von Art. 22 DSGVO statt.</p>

    <h3>14. Änderungen</h3>
    <p>Wenn sich die App ändert, passen wir diese Erklärung an. Die aktuelle Fassung findest du immer in der App unter „Mehr → Rechtliches".</p>
    <p class="legal-stand">Stand: ${STAND}</p>`],

  terms: ['Nutzungsbedingungen', `
    <h3>1. Worum es geht</h3>
    <p>„Was gibt's?" (betrieben von ${OWNER}) hilft Familien, aus vorhandenen Zutaten passende Gerichte zu finden, und bietet dazu Einkaufsliste, Wochenplan, Kochmodus und weitere Funktionen. Die Nutzung ist kostenlos.</p>
    <h3>2. Konto</h3>
    <p>Für die Nutzung brauchst du ein Konto mit gültiger E-Mail-Adresse. Halte dein Passwort geheim. Unter 16 Jahren nur mit Zustimmung der Eltern. Du kannst dein Konto jederzeit in der App löschen.</p>
    <h3>3. Familien</h3>
    <p>Wer eine Familie gründet, ist dort Admin und entscheidet über Beitrittsanfragen. Alle Mitglieder einer Familie sehen deren gemeinsame Inhalte. Teile den Familien-Code nur mit Menschen, denen du vertraust.</p>
    <h3>4. Deine Inhalte</h3>
    <p>Für eigene Rezepte, Namen und Feedback bist du selbst verantwortlich. Bitte keine rechtswidrigen, beleidigenden oder fremden urheberrechtlich geschützten Inhalte einstellen. Du räumst uns nur die Rechte ein, die nötig sind, um deine Inhalte in der App für deine Familie anzuzeigen.</p>
    <h3>5. Faire Nutzung</h3>
    <p>Bitte nutze die App nicht missbräuchlich, z. B. durch automatisierte Massenabfragen, Angriffe auf die Technik oder Spam. Bei Verstößen können wir Konten sperren.</p>
    <h3>6. Verfügbarkeit und Änderungen</h3>
    <p>Wir bemühen uns um einen zuverlässigen Betrieb, können aber keine ständige Verfügbarkeit garantieren. Funktionen können sich ändern, erweitert oder eingestellt werden. Die KI-Funktionen hängen von Diensten Dritter ab und können zeitweise begrenzt sein (z. B. Tageslimit).</p>
    <h3>7. „Was gibt's? Plus"</h3>
    <p>Plus ist angekündigt, aber noch nicht buchbar. Mit „Ich hätte Interesse" gehst du keinerlei Verpflichtung ein und es entstehen keine Kosten. Für ein späteres Abo gelten gesonderte Bedingungen, denen du dann ausdrücklich zustimmst.</p>
    <h3>8. Haftung</h3>
    <p>Wir haften unbeschränkt bei Vorsatz und grober Fahrlässigkeit sowie bei Verletzung von Leben, Körper oder Gesundheit. Bei leichter Fahrlässigkeit haften wir nur bei Verletzung wesentlicher Pflichten und begrenzt auf den vorhersehbaren, typischen Schaden. Im Übrigen ist die Haftung ausgeschlossen. Bitte beachte auch den Haftungsausschluss.</p>
    <h3>9. Schlussbestimmungen</h3>
    <p>Es gilt deutsches Recht. Zwingende Verbraucherschutzvorschriften deines Wohnsitzlandes bleiben unberührt. Ändern sich diese Bedingungen, informieren wir dich in der App.</p>
    <p class="legal-stand">Stand: ${STAND}</p>`],

  disclaimer: ['Haftungsausschluss', `
    <h3>Rezepte und Kochanleitungen</h3>
    <p>Rezepte, Mengen, Garzeiten, Herdstufen und Temperaturen sind Richtwerte. Herde, Öfen und Zutaten unterscheiden sich – prüfe immer selbst, ob Speisen durchgegart sind, besonders bei Geflügel, Hackfleisch, Fisch und Eiern. Achte beim Kochen auf heiße Oberflächen, scharfe Messer und heißes Fett. Kinder sollten nur unter Aufsicht kochen.</p>
    <h3>Allergien und Unverträglichkeiten</h3>
    <p>Die Hinweise zu Allergenen (z. B. Laktose, Gluten, Nüsse) und die Filter in der App sind eine Hilfe, <b>aber keine Garantie</b>. Zutaten enthalten oft versteckte Allergene oder Spuren. Lies bei Allergien immer die Zutatenliste auf der Verpackung. Die App ersetzt keine ärztliche oder ernährungsfachliche Beratung.</p>
    <h3>Haltbarkeit und Lebensmittelsicherheit</h3>
    <p>Erkannte Haltbarkeitsdaten und Warnungen können falsch sein. Maßgeblich ist immer das Datum auf der Verpackung und dein eigener Eindruck. Das Mindesthaltbarkeitsdatum ist kein Verfallsdatum: Viele Lebensmittel sind danach noch gut – prüfe Aussehen, Geruch und Geschmack. Lebensmittel mit „zu verbrauchen bis" (z. B. frisches Hackfleisch, Geflügel) nach Ablauf nicht mehr essen.</p>
    <h3>Künstliche Intelligenz</h3>
    <p>Foto-Erkennung, ausführliche Kochschritte und die Auswahl von Rezeptfotos werden von einer KI erstellt. KI kann sich irren. Prüfe die Ergebnisse mit gesundem Menschenverstand.</p>
    <h3>Fotos</h3>
    <p>Rezeptfotos werden automatisch ausgewählt und zeigen ein ähnliches Gericht. Das Aussehen kann vom eigenen Ergebnis abweichen.</p>
    <h3>Externe Links</h3>
    <p>Die App enthält Links zu fremden Webseiten (z. B. Pexels). Für deren Inhalte sind ausschließlich die jeweiligen Betreiber verantwortlich. Bei Bekanntwerden von Rechtsverletzungen entfernen wir solche Links umgehend.</p>
    <h3>Urheberrecht</h3>
    <p>Texte, Gestaltung und Rezeptsammlung der App sind urheberrechtlich geschützt. Fotos stammen von Pexels und unterliegen der Pexels-Lizenz; die Fotografen sind am Bild genannt.</p>
    <p class="legal-stand">Stand: ${STAND}</p>`],
};
export const LEGAL_ORDER = ['impressum', 'privacy', 'terms', 'disclaimer'];
