# Fire TV Stick: Vesalo-Homescreen und Debloat

Diesen Ordner nutzt eine Claude-Code-Sitzung **auf einem Rechner im WLAN „BMWlan“**.
Die beiden Patches enthalten die Vesalo-Version von [FireFrame](https://github.com/dyascj/FireFrame)
(Basis: Commit `a5ec3a1`). Bereits geprüft: Die Skripte senden nichts nach außen. Die App fragt nur
einmal am Tag GitHub-Releases nach Updates ab.

## Auftrag (in Claude Code auf dem PC einfügen)

```text
Richte meinen Fire TV Stick HD (Fire OS 7.7.1.7, IP 192.168.2.73) ein. ADB-Debugging ist an.

1. Klone https://github.com/dyascj/FireFrame, checke Commit a5ec3a1 aus und wende mit
   "git am" beide Patches aus fire-tv/ in diesem vesalo-uptime-Repo an
   (Zweig claude/fire-tv-debloat-launcher-xi3z91).
2. Installiere, was fehlt: adb (Android platform-tools), Java 17 (nicht 21: d8 bricht mit 21 ab),
   Android SDK mit "platforms;android-34" und "build-tools;34.0.0". Unter Windows die .sh-Skripte
   in Git Bash ausführen.
3. Prüfe, dass dieser Rechner eine 192.168.2.x-Adresse hat. Verbinde per adb. Sag mir, BEVOR
   die Abfrage auf dem TV kommt, dass ich "Immer von diesem Computer zulassen" anhaken muss.
4. Lies per adb die echten App-Namen aus und gleiche sie mit MY_APPS in HomeScreen.java ab
   (Netflix, Prime Video, YouTube, DAZN, WOW, RTL+, Crunchyroll; Spiegeln = OneCast).
   Passe die Namen an, falls sie abweichen.
5. ./fireframe.sh debloat 192.168.2.73 --dry-run, zeig mir die Liste. Danach NUR die Gruppe
   "safe" ausführen: kein --also, kein --all. Prime Video, Alexa, Casting und Updates bleiben an.
   Netflix, YouTube, DAZN, WOW, RTL+, Crunchyroll, OneCast niemals anfassen.
6. ./fireframe.sh install 192.168.2.73 (baut die App, schaltet die Home-Taste per adb frei).
   key.jks gut aufbewahren: Spätere Updates müssen mit demselben Schlüssel signiert sein.
7. Prüfen: Speicher vorher/nachher. Stick per adb neu starten. Danach per adb prüfen:
   Vesalo-Homescreen im Vordergrund, Bedienungshilfe aktiv, deaktivierte Pakete wirklich aus.
   Mach einen Screenshot vom TV (adb exec-out screencap -p). Berichte nur, was du gesehen hast.
```

## Rückgängig machen

- Alles: `./fireframe.sh undo 192.168.2.73` (mit `--uninstall` auch die App entfernen)
- Ein Paket: `adb -s 192.168.2.73:5555 shell pm enable <paketname>`
- Notfall: Werksreset über Einstellungen → Mein Fire TV → Auf Werkseinstellungen zurücksetzen,
  oder Zurück + Rechts auf der Fernbedienung 10 Sekunden halten.
- Danach ADB-Debugging in den Entwickleroptionen wieder ausschalten.
