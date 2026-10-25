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
};
export const ingName = k => ING[k] ? ING[k][0] : k;
export const ingEmoji = k => ING[k] ? ING[k][1] : '•';

/* ---------- Rezepte (feste Sammlung) ----------
   m: gesund | normal | fast   t: Minuten   i: Pflicht-Zutaten   o: optional   x: Merkmale */
export const R = [
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
export const recipe = id => R.find(r=>r.id===id);
export const ALLERGENS = {laktose:'Laktose', gluten:'Gluten'};
export const TRAITS = {scharf:'Scharfes', fisch:'Fisch', fleisch:'Fleisch'};
export const allergensOf = r => [...new Set(r.i.flatMap(k => (ING[k]&&ING[k][3])||[]))];

