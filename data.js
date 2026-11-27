/* Was gibt's? – Zutaten und feste Rezeptsammlung */
/* ---------- Zutaten ---------- */
export const ING = {
  eier:['Eier','🥚','k'], milch:['Milch','🥛','k',['laktose']], butter:['Butter','🧈','k',['laktose']], sahne:['Sahne','🍶','k',['laktose']],
  kaese:['Käse','🧀','k',['laktose']], mozzarella:['Mozzarella','⚪','k',['laktose']], feta:['Feta','🧊','k',['laktose']], joghurt:['Joghurt','🥣','k',['laktose']],
  hackfleisch:['Hackfleisch','🥩','k'], haehnchen:['Hähnchen','🍗','k'], schinken:['Schinken','🥓','k'], lachs:['Lachs','🐟','k'],
  tofu:['Tofu','⬜','k'], paprika:['Paprika','🫑','k'], tomaten:['Tomaten','🍅','k'], zucchini:['Zucchini','🥒','k'],
  brokkoli:['Brokkoli','🥦','k'], spinat:['Spinat','🥬','k'], champignons:['Champignons','🍄','k'], zwiebeln:['Zwiebeln','🧅','k'],
  knoblauch:['Knoblauch','🧄','k'], karotten:['Karotten','🥕','k'], kartoffeln:['Kartoffeln','🥔','k'], gurke:['Gurke','🥒','k'],
  salat:['Salat','🥗','k'], salami:['Salami','🍕','k'], wuerstchen:['Würstchen','🌭','k'], frischkaese:['Frischkäse','🧀','k',['laktose']], quark:['Quark','🥣','k',['laktose']], avocado:['Avocado','🥑','k'], zitrone:['Zitrone','🍋','k'],
  nudeln:['Nudeln','🍝','v',['gluten']], reis:['Reis','🍚','v'], mehl:['Mehl','🌾','v',['gluten']], hefe:['Hefe','🫙','v'],
  tortillas:['Tortillas','🌯','v',['gluten']], brot:['Brot','🍞','v',['gluten']], broetchen:['Burger-Brötchen','🍔','v',['gluten']],
  passierte:['Passierte Tomaten','🥫','v'], kokosmilch:['Kokosmilch','🥥','v'], linsen:['Linsen','🫘','v'], kichererbsen:['Kichererbsen','🫘','v'],
  kidney:['Kidneybohnen','🫘','v'], mais:['Mais','🌽','v'], thunfisch:['Thunfisch','🐟','v'], sojasosse:['Sojasoße','🍶','v',['gluten']],
  // Erweiterung für die große Rezeptsammlung
  rind:['Rindfleisch','🥩','k'], schwein:['Schweinefleisch','🥩','k'], pute:['Putenfleisch','🍗','k'], speck:['Speck','🥓','k'],
  garnelen:['Garnelen','🦐','k'], fischfilet:['Fischfilet','🐟','k'], parmesan:['Parmesan','🧀','k',['laktose']], schmand:['Schmand','🥛','k',['laktose']],
  aubergine:['Aubergine','🍆','k'], blumenkohl:['Blumenkohl','🥦','k'], lauch:['Lauch','🥬','k'], sellerie:['Sellerie','🥬','k'], kuerbis:['Kürbis','🎃','k'],
  erbsen:['Erbsen','🫛','k'], gruenebohnen:['Grüne Bohnen','🫛','k'], kohl:['Weißkohl','🥬','k'], rotkohl:['Rotkohl','🥬','k'], suesskartoffel:['Süßkartoffel','🍠','k'],
  fruehlingszwiebeln:['Frühlingszwiebeln','🧅','k'], chili:['Chili','🌶️','k'], ingwer:['Ingwer','🫚','k'], kraeuter:['Frische Kräuter','🌿','k'],
  apfel:['Äpfel','🍎','k'], banane:['Bananen','🍌','k'], beeren:['Beeren','🍓','k'], blaetterteig:['Blätterteig','🥐','k',['gluten']], gnocchi:['Gnocchi','🥟','k',['gluten']],
  haferflocken:['Haferflocken','🥣','v',['gluten']], backpulver:['Backpulver','🧂','v'], honig:['Honig','🍯','v'], tomatenmark:['Tomatenmark','🥫','v'],
  paniermehl:['Paniermehl','🍞','v',['gluten']], couscous:['Couscous','🌾','v',['gluten']], lasagne:['Lasagneplatten','🍝','v',['gluten']], quinoa:['Quinoa','🌾','v'],
  nuesse:['Nüsse','🥜','v',['nuesse']], erdnussbutter:['Erdnussbutter','🥜','v',['nuesse']], schokolade:['Schokolade','🍫','v',['laktose']], currypaste:['Currypaste','🥫','v'],
  /* Weihnachten */
  zucker:['Zucker','🍬','v'], puderzucker:['Puderzucker','❄️','v'], vanille:['Vanillezucker','🌼','v'],
  zimt:['Zimt','🪵','v'], lebkuchengewuerz:['Lebkuchengewürz','🫙','v'], mandeln:['Mandeln','🌰','v',['nuesse']],
  marzipan:['Marzipan','🍥','v',['nuesse']], rosinen:['Rosinen','🍇','v'], orangen:['Orangen','🍊','v'],
  spekulatius:['Spekulatius','🍪','v',['gluten']], preiselbeeren:['Preiselbeeren','🫐','v'],
  gans:['Gans','🍖','k'], kloesse:['Klöße','🥟','k'], raclettekaese:['Raclettekäse','🫕','k',['laktose']],
  gruenkohl:['Grünkohl','🥬','k'],
  pesto:['Pesto','🌿','v',['laktose']], senf:['Senf','🟡','v'], reisnudeln:['Reisnudeln','🍜','v'], weissebohnen:['Weiße Bohnen','🫘','v'], oliven:['Oliven','🫒','v'], ananas:['Ananas (Dose)','🍍','v'],
};
/* Fleisch und Fisch werden automatisch erkannt (für vegetarische Familienmitglieder) */
export const MEAT = ['hackfleisch','haehnchen','schinken','salami','wuerstchen','rind','schwein','pute','speck','gans'];
export const FISH = ['lachs','thunfisch','garnelen','fischfilet'];
/* Kategorien für den Kühlschrank (Reihenfolge = Anzeige) */
export const CATS = [
  ['gemuese','🥦','Gemüse',['paprika', 'tomaten', 'zucchini', 'brokkoli', 'spinat', 'champignons', 'zwiebeln', 'knoblauch', 'karotten', 'kartoffeln', 'gurke', 'salat', 'avocado', 'aubergine', 'blumenkohl', 'lauch', 'sellerie', 'kuerbis', 'erbsen', 'gruenebohnen', 'kohl', 'rotkohl', 'gruenkohl', 'suesskartoffel', 'fruehlingszwiebeln', 'chili', 'ingwer', 'kraeuter']],
  ['obst','🍎','Obst',['zitrone', 'apfel', 'banane', 'beeren', 'orangen']],
  ['fleisch','🥩','Fleisch & Fisch',['hackfleisch', 'haehnchen', 'pute', 'rind', 'schwein', 'schinken', 'speck', 'salami', 'wuerstchen', 'gans', 'lachs', 'fischfilet', 'garnelen']],
  ['milch','🥛','Milch, Käse & Eier',['eier', 'milch', 'butter', 'sahne', 'schmand', 'joghurt', 'quark', 'frischkaese', 'kaese', 'mozzarella', 'feta', 'parmesan', 'raclettekaese']],
  ['kuehl','🧊','Kühlregal',['tofu', 'gnocchi', 'blaetterteig', 'kloesse']],
  ['getreide','🍝','Nudeln, Reis & Brot',['nudeln', 'reisnudeln', 'lasagne', 'reis', 'couscous', 'quinoa', 'haferflocken', 'brot', 'broetchen', 'tortillas']],
  ['dose','🥫','Dosen & Gläser',['passierte', 'tomatenmark', 'kokosmilch', 'linsen', 'kichererbsen', 'kidney', 'weissebohnen', 'mais', 'thunfisch', 'oliven', 'ananas', 'preiselbeeren']],
  ['backen','🧁','Backen & Süßes',['mehl', 'hefe', 'backpulver', 'paniermehl', 'honig', 'schokolade', 'nuesse', 'erdnussbutter', 'zucker', 'puderzucker', 'vanille', 'mandeln', 'marzipan', 'rosinen', 'spekulatius']],
  ['wuerz','🧂','Soßen & Würzen',['sojasosse', 'currypaste', 'pesto', 'senf', 'zimt', 'lebkuchengewuerz']],
];
export const ingName = k => ING[k] ? ING[k][0] : k;
export const ingEmoji = k => ING[k] ? ING[k][1] : '•';

/* ---------- Rezepte (feste Sammlung) ----------
   m: gesund | normal | fast   t: Minuten   i: Pflicht-Zutaten   o: optional   x: Merkmale */
export const R = [
  /* ---------- Weihnachten (w:1 – tauchen in der Weihnachts-Sammlung auf) ---------- */
  {id:'kartsalat',w:1,n:'Kartoffelsalat mit Würstchen',e:'🥔',t:40,m:'normal',i:['kartoffeln','wuerstchen','zwiebeln','senf'],o:['gurke','schmand','kraeuter'],x:['fleisch'],s:['Kartoffeln mit Schale in Salzwasser 20 Minuten kochen, abgießen, kurz ausdampfen lassen.','Noch warm pellen und in Scheiben schneiden – warm saugen sie die Soße besser auf.','Zwiebel fein würfeln. Aus Senf, Essig, Öl, Salz, Pfeffer und einer Prise Zucker eine Soße rühren.','Alles vorsichtig mischen und mindestens 30 Minuten ziehen lassen.','Würstchen in heißem (nicht kochendem) Wasser 8 Minuten ziehen lassen und dazu servieren.']},
  {id:'raclette',w:1,n:'Raclette für alle',e:'🫕',t:30,m:'normal',i:['raclettekaese','kartoffeln','zwiebeln','paprika'],o:['champignons','schinken','mais','gurke','ananas'],x:['fleisch'],s:['Kartoffeln in Salzwasser 20 Minuten kochen – das geht gut schon am Nachmittag.','Alles Gemüse klein schneiden und in Schälchen auf den Tisch stellen.','Raclettekäse in Scheiben auf die Pfännchen legen, Zutaten darunter.','Pfännchen 5 bis 8 Minuten unter den Grill schieben, bis der Käse Blasen wirft.','Über die Kartoffeln stürzen. Danach gleich das nächste Pfännchen füllen.']},
  {id:'kaesefondue',w:1,n:'Käsefondue',e:'🧀',t:30,m:'normal',i:['kaese','brot','knoblauch'],o:['mehl','champignons','gurke'],x:[],s:['Brot in mundgerechte Würfel schneiden – am besten etwas trockenes Brot.','Den Fonduetopf innen mit einer halbierten Knoblauchzehe ausreiben.','Käse grob reiben, mit etwas Mehl mischen, damit er nicht klumpt.','Bei milder Hitze unter ständigem Rühren schmelzen, mit Pfeffer und Muskat würzen.','Auf dem Rechaud warm halten. Immer in Achterbewegungen rühren, dann bleibt er cremig.']},
  {id:'gansbraten',w:1,n:'Weihnachtsgans mit Rotkohl und Klößen',e:'🍖',t:210,m:'normal',i:['gans','rotkohl','kloesse','apfel','zwiebeln'],o:['orangen','kraeuter','preiselbeeren'],x:['fleisch'],s:['Gans waschen, trocken tupfen, innen und außen kräftig salzen und pfeffern.','Mit Apfelstücken und Zwiebeln füllen und auf ein Blech mit etwas Wasser setzen.','Bei 160 Grad etwa 3 Stunden braten. Jede halbe Stunde mit dem eigenen Saft übergießen.','Die letzten 15 Minuten auf 220 Grad stellen, damit die Haut knusprig wird.','Rotkohl erwärmen, Klöße in heißem Wasser ziehen lassen – nicht kochen, sonst zerfallen sie.','Gans 10 Minuten ruhen lassen, dann tranchieren. Bratensaft als Soße dazu.']},
  {id:'rotkohlapf',w:1,n:'Apfelrotkohl',e:'🫐',t:45,m:'gesund',i:['rotkohl','apfel','zwiebeln'],o:['zimt','zucker','preiselbeeren'],x:[],s:['Rotkohl in feine Streifen hobeln, Zwiebel würfeln, Apfel grob raspeln.','Zwiebel in etwas Fett anschwitzen, Rotkohl dazu und kurz mitdünsten.','Apfel, einen Schuss Essig, etwas Zucker, Salz und eine Nelke oder Zimt zugeben.','Mit etwas Wasser auffüllen und 30 Minuten zugedeckt schmoren.','Zum Schluss abschmecken – Rotkohl braucht süß und sauer im Gleichgewicht.']},
  {id:'gruenkohlw',w:1,n:'Grünkohl mit Würstchen',e:'🥬',t:70,m:'normal',i:['gruenkohl','wuerstchen','zwiebeln','kartoffeln'],o:['speck','senf'],x:['fleisch'],s:['Grünkohl waschen, dicke Stiele entfernen, grob hacken.','Zwiebeln und Speck in einem großen Topf auslassen.','Grünkohl dazu, mit Brühe auffüllen und 45 Minuten köcheln lassen.','Würstchen die letzten 15 Minuten mitziehen lassen.','Mit Senf, Salz und Pfeffer abschmecken. Dazu Salzkartoffeln.']},
  {id:'rouladen',w:1,n:'Rinderrouladen',e:'🥩',t:120,m:'normal',i:['rind','senf','speck','gurke','zwiebeln'],o:['karotten','sellerie'],x:['fleisch'],s:['Fleischscheiben flach klopfen, salzen, pfeffern und mit Senf bestreichen.','Speck, Gurkenstreifen und Zwiebel darauflegen, aufrollen und feststecken.','Rouladen rundherum scharf anbraten und herausnehmen.','Gemüse im Bratfett anrösten, mit Wasser oder Brühe ablöschen.','Rouladen zurück in den Topf, zugedeckt 90 Minuten schmoren.','Soße durchsieben und abschmecken. Dazu Klöße und Rotkohl.']},
  {id:'vanillekipferl',w:1,meal:'suess',n:'Vanillekipferl',e:'🌙',t:60,m:'normal',i:['mehl','butter','mandeln','zucker','puderzucker','vanille'],o:['eier'],x:[],s:['Mehl, gemahlene Mandeln, Zucker und kalte Butter rasch zu einem Teig verkneten.','Teig in Folie wickeln und eine Stunde kalt stellen – das ist der ganze Trick.','Fingerdicke Rollen formen, Stücke abschneiden und zu Hörnchen biegen.','Bei 180 Grad 10 bis 12 Minuten backen, bis die Spitzen hellbraun sind.','Noch heiß in einer Mischung aus Puderzucker und Vanillezucker wenden.']},
  {id:'zimtsterne',w:1,meal:'suess',n:'Zimtsterne',e:'⭐',t:70,m:'normal',i:['mandeln','eier','puderzucker','zimt'],o:['zitrone'],x:[],s:['Eiweiß steif schlagen, Puderzucker langsam einrieseln lassen.','Drei Esslöffel vom Eischnee für den Guss beiseitestellen.','Gemahlene Mandeln und Zimt unter den Rest heben.','Teig zwischen zwei Lagen Backpapier 1 cm dick ausrollen, Sterne ausstechen.','Mit dem Guss bestreichen und bei 150 Grad 12 bis 15 Minuten backen – innen sollen sie weich bleiben.']},
  {id:'butterplaetz',w:1,meal:'suess',n:'Ausstechplätzchen',e:'🍪',t:60,m:'normal',i:['mehl','butter','zucker','eier'],o:['puderzucker','schokolade','vanille'],x:[],s:['Mehl, Zucker, kalte Butterwürfel und ein Ei zu einem glatten Teig verkneten.','Eine Stunde kalt stellen, sonst klebt alles.','Teig 3 mm dick ausrollen und Formen ausstechen.','Bei 180 Grad 8 bis 10 Minuten backen – sie sollen nur ganz leicht Farbe nehmen.','Auskühlen lassen, dann mit Zuckerguss oder geschmolzener Schokolade verzieren.']},
  {id:'lebkuchen',w:1,meal:'suess',n:'Weiche Lebkuchen',e:'🍯',t:50,m:'normal',i:['mehl','honig','eier','lebkuchengewuerz','mandeln'],o:['schokolade','orangen','backpulver'],x:[],s:['Honig mit etwas Butter erwärmen, bis alles flüssig ist, dann abkühlen lassen.','Mit Ei, Mehl, gemahlenen Mandeln, Lebkuchengewürz und Backpulver verrühren.','Mit zwei Löffeln kleine Häufchen aufs Blech setzen oder auf Oblaten streichen.','Bei 180 Grad 12 bis 15 Minuten backen.','Noch warm mit Schokolade oder Zuckerguss überziehen.']},
  {id:'bratapfel',w:1,meal:'suess',n:'Bratapfel mit Marzipan',e:'🍎',t:45,m:'normal',i:['apfel','marzipan','nuesse','butter'],o:['rosinen','honig','zimt','sahne'],x:[],s:['Äpfel waschen und das Kerngehäuse mit einem Ausstecher herausdrehen.','Marzipan mit gehackten Nüssen und Rosinen verkneten.','Die Äpfel damit füllen, je ein Butterflöckchen oben drauf.','In eine Auflaufform setzen, einen kleinen Schluck Wasser angießen.','Bei 180 Grad 30 Minuten backen. Mit Vanillesoße oder Sahne servieren.']},
  {id:'stollen',w:1,meal:'suess',n:'Christstollen',e:'🍞',t:150,m:'normal',i:['mehl','butter','hefe','rosinen','mandeln','milch','zucker'],o:['marzipan','puderzucker','orangen'],x:[],s:['Rosinen am Vorabend in Saft oder Rum einweichen.','Aus Mehl, Hefe, lauwarmer Milch, Zucker und weicher Butter einen Hefeteig kneten.','Eine Stunde gehen lassen, bis er sich sichtbar vergrößert hat.','Rosinen und Mandeln unterkneten, Teig zum Stollen formen – ein Marzipanstrang in der Mitte ist erlaubt.','Bei 170 Grad 60 Minuten backen, dabei nach 40 Minuten abdecken.','Noch heiß mit flüssiger Butter bestreichen und dick mit Puderzucker bestäuben.','Mindestens drei Tage durchziehen lassen – dann schmeckt er erst richtig.']},
  {id:'kinderpunsch',w:1,meal:'suess',n:'Kinderpunsch',e:'☕',t:15,m:'fast',i:['orangen','apfel','zimt'],o:['honig','beeren','zitrone'],x:[],s:['Saft von Orangen und Äpfeln in einen Topf geben – gekaufter Saft geht genauso.','Eine Zimtstange, ein paar Nelken und Orangenscheiben dazu.','Langsam erhitzen, aber nicht kochen lassen, sonst wird er bitter.','10 Minuten ziehen lassen, mit Honig süßen.','Gewürze herausnehmen und heiß in Tassen füllen.']},
  {id:'spekutira',w:1,meal:'suess',n:'Spekulatius-Tiramisu',e:'🥄',t:30,m:'fast',i:['spekulatius','quark','sahne','zucker'],o:['schokolade','zimt','orangen'],x:[],s:['Sahne steif schlagen und mit Quark, Zucker und etwas Vanille verrühren.','Spekulatius in kalten Kakao oder Orangensaft tauchen – nur kurz, sonst matscht alles.','Abwechselnd Kekse und Creme in eine Form schichten, oben Creme.','Mindestens 3 Stunden kalt stellen, über Nacht ist besser.','Vor dem Servieren mit Kakao und zerbröseltem Spekulatius bestreuen.']},
  {id:'bolo',n:'Spaghetti Bolognese',e:'🍝',t:30,m:'normal',i:['nudeln','hackfleisch','passierte','zwiebeln','knoblauch'],o:['karotten','kaese'],x:['fleisch'],s:['Zwiebeln, Knoblauch und Karotte fein hacken und anbraten.','Hackfleisch dazu und krümelig braten.','Passierte Tomaten dazu, salzen, 15 Minuten köcheln.','Nudeln kochen und mit der Soße servieren.']},
  {id:'tomnud',n:'Nudeln mit Tomatensoße',e:'🍅',t:20,m:'normal',i:['nudeln','passierte','zwiebeln','knoblauch'],o:['kaese'],x:[],s:['Zwiebeln und Knoblauch in Öl anschwitzen.','Passierte Tomaten dazu, mit Salz, Pfeffer und etwas Zucker würzen.','10 Minuten köcheln, Nudeln kochen, alles mischen.']},
  {id:'pfannk',n:'Pfannkuchen',e:'🥞',t:20,m:'normal',i:['mehl','eier','milch'],o:['butter'],x:[],s:['Mehl, Eier, Milch und eine Prise Salz glatt rühren.','10 Minuten quellen lassen.','In der Pfanne dünn ausbacken, süß oder herzhaft füllen.']},
  {id:'ruehrei',n:'Rührei mit Brot',e:'🍳',t:10,m:'normal',i:['eier','brot'],o:['butter','tomaten'],x:[],s:['Eier mit Salz und Pfeffer verquirlen.','In Butter bei mittlerer Hitze langsam stocken lassen.','Mit Brot und Tomaten servieren.']},
  {id:'omelett',n:'Gemüse-Omelett',e:'🥚',t:15,m:'gesund',i:['eier','paprika','zwiebeln'],o:['kaese','spinat'],x:[],s:['Paprika und Zwiebel klein schneiden und anbraten.','Verquirlte Eier darübergießen.','Bei kleiner Hitze stocken lassen, zusammenklappen.']},
  {id:'burger',n:'Selbstgemachte Burger',e:'🍔',t:30,m:'fast',i:['broetchen','hackfleisch','salat','tomaten'],o:['kaese','zwiebeln','gurke'],x:['fleisch'],s:['Hackfleisch salzen, pfeffern und zu flachen Patties formen.','Pro Seite 3 bis 4 Minuten braten, am Ende Käse drauflegen.','Brötchen rösten und mit Salat, Tomate und Patty belegen.']},
  {id:'pizza',n:'Pizza vom Blech',e:'🍕',t:45,m:'fast',i:['mehl','hefe','passierte','mozzarella'],o:['schinken','paprika','champignons','mais'],x:[],s:['500 g Mehl, Hefe, 300 ml warmes Wasser, Salz und Öl verkneten, 20 Minuten gehen lassen.','Teig aufs Blech ausrollen, mit Tomaten bestreichen.','Belegen, wie jeder mag, Mozzarella drauf.','Bei 230 °C etwa 15 Minuten backen.']},
  {id:'wraps',n:'Chicken Wraps',e:'🌯',t:20,m:'fast',i:['tortillas','haehnchen','salat','tomaten'],o:['joghurt','mais','kaese'],x:['fleisch'],s:['Hähnchen in Streifen schneiden, würzen und braten.','Tortillas kurz in der Pfanne erwärmen.','Mit Salat, Tomate, Hähnchen und Joghurtsoße füllen und einrollen.']},
  {id:'quesa',n:'Käse-Quesadillas',e:'🧀',t:15,m:'fast',i:['tortillas','kaese','mais'],o:['paprika','kidney'],x:[],s:['Käse, Mais und Paprika auf eine Tortilla-Hälfte streuen.','Zuklappen und in der Pfanne von beiden Seiten goldbraun braten.','In Stücke schneiden.']},
  {id:'chili',n:'Chili con Carne',e:'🌶️',t:40,m:'normal',i:['hackfleisch','kidney','mais','passierte','zwiebeln'],o:['paprika','reis'],x:['fleisch','scharf'],s:['Zwiebeln und Hackfleisch anbraten.','Paprika, Tomaten, Bohnen und Mais dazu.','Mit Chili, Kreuzkümmel und Salz würzen, 25 Minuten köcheln.']},
  {id:'chilisin',n:'Chili sin Carne',e:'🫘',t:35,m:'gesund',i:['kidney','mais','passierte','zwiebeln','paprika'],o:['linsen','reis'],x:['scharf'],s:['Zwiebeln und Paprika anbraten.','Tomaten, Bohnen, Mais und Linsen dazu.','Kräftig würzen und 20 Minuten köcheln.']},
  {id:'currych',n:'Hähnchen-Curry mit Reis',e:'🍛',t:30,m:'normal',i:['haehnchen','kokosmilch','reis','zwiebeln'],o:['paprika','karotten'],x:['fleisch'],s:['Reis kochen.','Hähnchen und Zwiebeln anbraten, Currypulver dazu.','Gemüse und Kokosmilch dazu, 15 Minuten köcheln.']},
  {id:'curryveg',n:'Gemüse-Curry',e:'🥥',t:30,m:'gesund',i:['kokosmilch','reis','karotten','kichererbsen'],o:['zucchini','spinat','paprika'],x:[],s:['Reis kochen.','Gemüse klein schneiden und mit Currypulver anbraten.','Kichererbsen und Kokosmilch dazu, 15 Minuten köcheln.']},
  {id:'friedrice',n:'Gebratener Reis',e:'🥡',t:20,m:'normal',i:['reis','eier','karotten','sojasosse'],o:['mais','zwiebeln'],x:[],s:['Am besten Reis vom Vortag nehmen.','Gemüse scharf anbraten, Reis dazu.','Eier an den Rand schlagen, verrühren, mit Sojasoße abschmecken.']},
  {id:'ofenkart',n:'Ofenkartoffeln mit Kräuterdip',e:'🥔',t:45,m:'gesund',i:['kartoffeln','joghurt'],o:['knoblauch','gurke'],x:[],s:['Kartoffeln halbieren, mit Öl und Salz bei 200 °C 35 Minuten backen.','Joghurt mit Knoblauch, Salz und Kräutern verrühren.','Zusammen servieren.']},
  {id:'bratkart',n:'Bratkartoffeln mit Spiegelei',e:'🍳',t:30,m:'normal',i:['kartoffeln','eier','zwiebeln'],o:['schinken'],x:[],s:['Gekochte Kartoffeln in Scheiben schneiden.','In Öl knusprig braten, Zwiebeln dazu.','Spiegeleier braten und obendrauf legen.']},
  {id:'kartsuppe',n:'Kartoffelsuppe',e:'🍲',t:40,m:'gesund',i:['kartoffeln','karotten','zwiebeln'],o:['sahne','schinken'],x:[],s:['Gemüse würfeln und in Öl anschwitzen.','Mit Wasser und Brühe bedecken, 20 Minuten kochen.','Teilweise pürieren, mit Sahne verfeinern.']},
  {id:'lachsofen',n:'Lachs mit Ofengemüse',e:'🐟',t:30,m:'gesund',i:['lachs','kartoffeln','brokkoli'],o:['zitrone'],x:['fisch'],s:['Kartoffeln würfeln und 15 Minuten bei 200 °C backen.','Brokkoli und Lachs dazulegen.','Weitere 12 Minuten backen, mit Zitrone servieren.']},
  {id:'lachsnud',n:'Lachs-Sahne-Nudeln',e:'🍝',t:20,m:'normal',i:['nudeln','lachs','sahne'],o:['zitrone','spinat'],x:['fisch'],s:['Nudeln kochen.','Lachs würfeln und kurz anbraten.','Sahne dazu, mit Zitrone, Salz und Pfeffer abschmecken.']},
  {id:'thunnud',n:'Thunfisch-Nudeln',e:'🐟',t:20,m:'normal',i:['nudeln','thunfisch','passierte'],o:['zwiebeln','mais'],x:['fisch'],s:['Nudeln kochen.','Zwiebeln anbraten, Tomaten und Thunfisch dazu.','5 Minuten köcheln und mit den Nudeln mischen.']},
  {id:'auflauf',n:'Brokkoli-Nudelauflauf',e:'🥦',t:40,m:'normal',i:['nudeln','brokkoli','sahne','kaese'],o:['schinken'],x:[],s:['Nudeln und Brokkoli kurz vorkochen.','In eine Form geben, Sahne mit Salz und Muskat darübergießen.','Käse drüber und 20 Minuten bei 200 °C backen.']},
  {id:'spinfeta',n:'Spinat-Feta-Pasta',e:'🥬',t:20,m:'gesund',i:['nudeln','spinat','feta','knoblauch'],o:['tomaten'],x:[],s:['Nudeln kochen.','Knoblauch in Öl anbraten, Spinat zusammenfallen lassen.','Feta zerbröseln, alles mit den Nudeln mischen.']},
  {id:'griech',n:'Griechischer Salat mit Brot',e:'🥗',t:10,m:'gesund',i:['gurke','tomaten','feta'],o:['zwiebeln','paprika','brot'],x:[],s:['Gemüse grob schneiden.','Feta drüberbröseln.','Mit Olivenöl, Salz und Oregano anmachen.']},
  {id:'tomsuppe',n:'Tomatensuppe',e:'🥣',t:25,m:'gesund',i:['passierte','zwiebeln','knoblauch'],o:['sahne','brot'],x:[],s:['Zwiebeln und Knoblauch anschwitzen.','Tomaten und etwas Wasser dazu, 15 Minuten köcheln.','Pürieren, mit Sahne servieren.']},
  {id:'dal',n:'Linsen-Dal',e:'🫘',t:30,m:'gesund',i:['linsen','kokosmilch','zwiebeln','knoblauch'],o:['tomaten','reis'],x:[],s:['Zwiebeln, Knoblauch und Gewürze anbraten.','Linsen, Kokosmilch und Wasser dazu.','20 Minuten köcheln, bis die Linsen weich sind.']},
  {id:'pfanne',n:'Hähnchen-Gemüse-Pfanne',e:'🥘',t:25,m:'gesund',i:['haehnchen','paprika','zucchini','reis'],o:['sojasosse','karotten'],x:['fleisch'],s:['Reis kochen.','Hähnchen anbraten, herausnehmen.','Gemüse braten, Hähnchen zurück, würzen.']},
  {id:'pilznud',n:'Champignon-Rahmnudeln',e:'🍄',t:20,m:'normal',i:['nudeln','champignons','sahne','zwiebeln'],o:['knoblauch'],x:[],s:['Nudeln kochen.','Pilze und Zwiebeln kräftig anbraten.','Sahne dazu, einköcheln lassen, mit den Nudeln mischen.']},
  {id:'toast',n:'Überbackene Toasts',e:'🥪',t:15,m:'fast',i:['brot','kaese','tomaten'],o:['schinken'],x:[],s:['Brot belegen mit Tomate und Schinken.','Käse darüber.','10 Minuten bei 200 °C überbacken.']},
  {id:'nuggets',n:'Chicken Nuggets selbstgemacht',e:'🍗',t:30,m:'fast',i:['haehnchen','eier','mehl'],o:['brot'],x:['fleisch'],s:['Hähnchen in Stücke schneiden.','In Mehl, Ei und Bröseln wenden.','Im Ofen bei 220 °C 15 Minuten knusprig backen.']},
  {id:'avotoast',n:'Avocado-Toast mit Ei',e:'🥑',t:10,m:'gesund',i:['brot','avocado','eier'],o:['zitrone','tomaten'],x:[],s:['Brot toasten.','Avocado zerdrücken, mit Zitrone und Salz würzen.','Mit Spiegelei oder gekochtem Ei belegen.']},
  {id:'bowl',n:'Kichererbsen-Bowl',e:'🥙',t:20,m:'gesund',i:['kichererbsen','reis','gurke','tomaten'],o:['joghurt','avocado'],x:[],s:['Reis kochen.','Kichererbsen mit Paprikapulver knusprig braten.','Alles in Schalen anrichten, Joghurt drüber.']},
  {id:'schnitzel',n:'Hähnchenschnitzel mit Pommes',e:'🍟',t:40,m:'fast',i:['haehnchen','kartoffeln','eier','mehl'],o:['zitrone'],x:['fleisch'],s:['Kartoffeln in Stifte schneiden, mit Öl bei 220 °C 30 Minuten backen.','Hähnchen flach klopfen, in Mehl, Ei und Bröseln wenden.','Goldbraun braten, mit Zitrone servieren.']},
  {id:'brotzeit',n:'Brotzeit mit Salami',e:'🥪',t:5,m:'normal',i:['brot','salami'],o:['butter','gurke','tomaten','kaese'],x:['fleisch'],s:['Brot in Scheiben schneiden und mit Butter bestreichen.','Mit Salami belegen.','Mit Gurke oder Tomate dazu servieren.']},
  {id:'pizzatoast',n:'Pizza-Toast',e:'🍕',t:15,m:'fast',i:['brot','salami','kaese'],o:['passierte','paprika'],x:['fleisch'],s:['Brot mit etwas Tomate bestreichen.','Mit Salami und Käse belegen.','Bei 200 °C etwa 10 Minuten überbacken.']},
  {id:'hotdog',n:'Hot Dogs',e:'🌭',t:15,m:'fast',i:['broetchen','wuerstchen'],o:['zwiebeln','gurke'],x:['fleisch'],s:['Würstchen in heißem Wasser 8 Minuten ziehen lassen.','Brötchen aufschneiden und kurz rösten.','Würstchen hineinlegen, nach Wunsch Zwiebeln und Gurke dazu.']},
  {id:'wurstkart',n:'Würstchen mit Bratkartoffeln',e:'🥔',t:30,m:'normal',i:['wuerstchen','kartoffeln','zwiebeln'],o:[],x:['fleisch'],s:['Gekochte Kartoffeln in Scheiben braten.','Zwiebeln dazugeben.','Würstchen in Scheiben schneiden und mitbraten.']},
  {id:'frischbrot',n:'Frischkäse-Brot mit Gurke',e:'🥒',t:5,m:'gesund',i:['brot','frischkaese'],o:['gurke','tomaten'],x:[],s:['Brot mit Frischkäse bestreichen.','Mit Gurken- oder Tomatenscheiben belegen.','Mit Salz und Pfeffer würzen.']},
  {id:'quarkkart',n:'Pellkartoffeln mit Kräuterquark',e:'🥔',t:30,m:'gesund',i:['kartoffeln','quark'],o:['zwiebeln','gurke'],x:[],s:['Kartoffeln mit Schale 20 Minuten kochen.','Quark mit Salz, Pfeffer, Kräutern und etwas Milch glatt rühren.','Zusammen servieren.']},
];
/* ---------- Große Sammlung (rezepte/*.js) ----------
   Eine Zeile pro Rezept: Name|Emoji|Minuten|Art|Pflicht-Zutaten|optionale Zutaten|Merkmale|Schritt 1;Schritt 2;…
   Art: g = gesund, n = normal, f = Fastfood   Merkmale: s = scharf, - = keine */
import B1 from './rezepte/1.js'; import B2 from './rezepte/2.js'; import B3 from './rezepte/3.js'; import B4 from './rezepte/4.js'; import B5 from './rezepte/5.js';
import B6 from './rezepte/6.js'; import B7 from './rezepte/7.js'; import B8 from './rezepte/8.js'; import B9 from './rezepte/9.js'; import B10 from './rezepte/10.js';
const MOOD = { g:'gesund', n:'normal', f:'fast' };
function parseBatch(prefix, text){
  return text.trim().split('\n').filter(l => l.trim()).map((line, n) => {
    const [name, e, t, m, req, opt, x, steps] = line.split('|');
    const i = req.trim().split(/\s+/).filter(Boolean), o = (opt||'').trim().split(/\s+/).filter(k => k && k !== '-');
    const traits = (x||'').includes('s') ? ['scharf'] : [];
    if (i.some(k => MEAT.includes(k))) traits.push('fleisch');
    if (i.some(k => FISH.includes(k))) traits.push('fisch');
    const meal = (x||'').includes('m') ? 'fruehstueck' : (x||'').includes('z') ? 'suess' : 'haupt';
    return { id: prefix + (n + 1), n: name.trim(), e: e.trim(), t: +t, m: MOOD[m.trim()] || 'normal', i, o, x: traits, meal, s: steps.split(';').map(s => s.trim()).filter(Boolean) };
  });
}
[B1,B2,B3,B4,B5,B6,B7,B8,B9,B10].forEach((b, k) => R.push(...parseBatch('b' + (k + 1) + '_', b)));
export const recipe = id => R.find(r=>r.id===id);
export const ALLERGENS = {laktose:'Laktose', gluten:'Gluten', nuesse:'Nüsse'};
export const TRAITS = {scharf:'Scharfes', fisch:'Fisch', fleisch:'Fleisch'};
export const allergensOf = r => [...new Set(r.i.flatMap(k => (ING[k]&&ING[k][3])||[]))];

