/**
 * Picking start/target pages.
 *
 * A curated list grouped by theme and tier drives every language:
 *   tier 1 = huge hub articles (easy targets), tier 2 = well-known topics, tier 3 = niche.
 * Other Wikipedias get the same articles through English interlanguage links (so pairs stay
 * family-friendly and themed); if that fails repeatedly we fall back to the wiki's most-read
 * articles. Every pick is verified against Wikipedia (redirects resolved) before it is used.
 */
import type { Difficulty, ThemeId } from '../shared/constants';
import { normalizeTitle } from '../shared/titles';
import { HttpError, pick } from './util';
import { randomArticle, resolveTitles, topArticles, translateFromEnglish } from './wiki';

type Tiers = [string, string, string];

// Pipe-separated lists keep this readable. Redirect titles are fine (they get resolved).
const CURATED: Record<Exclude<ThemeId, 'any'>, Tiers> = {
  geography: [
    'United States|United Kingdom|France|Germany|China|India|Japan|Russia|Italy|Spain|Canada|Brazil|Australia|Mexico|Egypt|Africa|Europe|Asia|South America|Atlantic Ocean|Pacific Ocean|Mediterranean Sea|London|Paris|New York City|Tokyo|Rome|Algeria|Morocco|Sahara|Turkey|Iran|Indonesia|Argentina|Nigeria',
    'Mount Everest|Amazon River|Nile|Great Wall of China|Eiffel Tower|Statue of Liberty|Grand Canyon|Niagara Falls|Mount Fuji|Dead Sea|Antarctica|Greenland|Iceland|Hawaii|Venice|Amsterdam|Istanbul|Cairo|Dubai|Sydney|Rio de Janeiro|Hong Kong|Singapore|Algiers|Atlas Mountains|Himalayas|Alps|Danube|Mississippi River|Sahara Desert|Madagascar|New Zealand|Las Vegas|Monaco|Vatican City|Kyoto|Petra|Timbuktu|Casablanca|Oran',
    'Nauru|Tristan da Cunha|Lake Baikal|Bouvet Island|Socotra|Svalbard|Tuvalu|Pitcairn Islands|Mariana Trench|Point Nemo|Uluru|Salar de Uyuni|Danakil Depression|Door to Hell|Lake Natron|Ha Long Bay|Cappadocia|Ghardaïa|Tassili n\'Ajjer|Kerguelen Islands|Liechtenstein|San Marino|Andorra|Faroe Islands|Easter Island|Galápagos Islands|Atacama Desert|Mount Kilimanjaro|Victoria Falls|Angel Falls',
  ],
  history: [
    'World War II|World War I|Roman Empire|Ancient Greece|Ancient Egypt|Middle Ages|Renaissance|Industrial Revolution|Cold War|Soviet Union|French Revolution|Napoleon|British Empire|Ottoman Empire|American Revolution|Holocaust|Byzantine Empire|Mongol Empire|Islamic Golden Age|Crusades',
    'Julius Caesar|Cleopatra|Alexander the Great|Genghis Khan|Queen Victoria|George Washington|Abraham Lincoln|Winston Churchill|Mahatma Gandhi|Nelson Mandela|Martin Luther King Jr.|Joan of Arc|Vikings|Samurai|Knight|Aztec Empire|Maya civilization|Inca Empire|Black Death|Silk Road|Berlin Wall|American Civil War|Apollo 11|Titanic|Magna Carta|Battle of Waterloo|Fall of Constantinople|Emir Abdelkader|Algerian War|Carthage|Hannibal|Saladin|Ibn Battuta|Charlemagne|Spartacus',
    'Great Emu War|Dancing plague of 1518|Great Molasses Flood|Tunguska event|Voynich manuscript|Antikythera mechanism|Rosetta Stone|Terracotta Army|Nazca Lines|Library of Alexandria|Lighthouse of Alexandria|War of the Bucket|Pig War|Defenestrations of Prague|Year Without a Summer|Christmas truce|Radium Girls|Lindow Man|Ötzi|Code of Hammurabi|Phaistos Disc|Baghdad Battery|Tulip mania|Children\'s Crusade|Siege of Malta|Numidia|Massinissa|Jugurtha|Tin Hinan|Kahina',
  ],
  science: [
    'Science|Mathematics|Physics|Chemistry|Biology|Earth|Moon|Sun|Solar System|Universe|Star|Planet|Water|Oxygen|Carbon|DNA|Evolution|Electricity|Energy|Medicine|Atom|Gravity|Light|Human|Albert Einstein|Isaac Newton',
    'Photosynthesis|Black hole|Big Bang|Theory of relativity|Quantum mechanics|Periodic table|Volcano|Earthquake|Tornado|Rainbow|Lightning|Climate change|Vaccine|Penicillin|Heart|Brain|Blood|Mars|Jupiter|Saturn|Milky Way|Marie Curie|Charles Darwin|Galileo Galilei|Nikola Tesla|Thomas Edison|Stephen Hawking|Ibn al-Haytham|Al-Khwarizmi|Gold|Iron|Diamond|Neutron star|Supernova|Plate tectonics',
    'Fermat\'s Last Theorem|Pi|Golden ratio|Fibonacci sequence|Schrödinger\'s cat|Higgs boson|Dark matter|Pulsar|Aurora|Ball lightning|Quicksand|Geyser|Stalactite|Ozone layer|Möbius strip|Klein bottle|Zeno\'s paradoxes|Monty Hall problem|Prime number|Absolute zero|Mpemba effect|Leidenfrost effect|Brownian motion|Hubble Space Telescope|Voyager 1|Sputnik 1|Olympus Mons|Europa (moon)|Pluto|Halley\'s Comet|Ununennium|Tachyon',
  ],
  nature: [
    'Animal|Plant|Bird|Fish|Mammal|Insect|Dinosaur|Tree|Forest|Ocean|Flower|Dog|Cat|Horse|Fungus|Bacteria',
    'Tiger|Lion|Elephant|Giraffe|Penguin|Shark|Dolphin|Whale|Octopus|Eagle|Wolf|Honey bee|Butterfly|Spider|Snake|Crocodile|Kangaroo|Giant panda|Polar bear|Tyrannosaurus|Cheetah|Gorilla|Chimpanzee|Owl|Parrot|Frog|Coral reef|Rainforest|Bamboo|Rose|Oak|Cactus|Camel|Fennec fox|Barbary macaque',
    'Platypus|Axolotl|Tardigrade|Narwhal|Capybara|Pangolin|Okapi|Aye-aye|Blobfish|Mantis shrimp|Tetraodontidae|Sloth|Naked mole-rat|Komodo dragon|Dodo|Woolly mammoth|Coelacanth|Venus flytrap|Rafflesia|Baobab|Immortal jellyfish|Pistol shrimp|Bombardier beetle|Lyrebird|Shoebill|Quokka|Dumbo octopus|Glass frog|Hagfish|Welwitschia|Dragon\'s blood tree|Atlas cedar',
  ],
  culture: [
    'Music|Film|Television|Art|Painting|Novel|Religion|Philosophy|Language|English language|Arabic language|Latin|William Shakespeare|Christianity|Islam|Buddhism|Hinduism|Rock music|Jazz|Architecture|Theatre|Poetry',
    'The Beatles|Michael Jackson|Elvis Presley|Wolfgang Amadeus Mozart|Ludwig van Beethoven|Taylor Swift|Queen (band)|Star Wars|Harry Potter|The Lord of the Rings|Batman|Superman|Mickey Mouse|Hollywood|The Walt Disney Company|Anime|Manga|Hip hop music|Opera|Ballet|Guitar|Piano|Violin|Christmas|Halloween|Ramadan|Eid al-Fitr|Leonardo da Vinci|Mona Lisa|Pablo Picasso|Vincent van Gogh|Frida Kahlo|One Thousand and One Nights|Raï|Cheb Khaled|Albert Camus|Greek mythology|Norse mythology|Sherlock Holmes|Dracula',
    'Theremin|Kazoo|Bagpipes|Didgeridoo|Accordion|Yodeling|Beatboxing|Vaporwave|Barbershop music|Mime artist|Ventriloquism|Juggling|Origami|Esperanto|Braille|Egyptian hieroglyphs|Cuneiform|Morse code|Tifinagh|Klingon language|Rickrolling|Lorem ipsum|Fountain (Duchamp)|The Scream|Bayeux Tapestry|Ship of Theseus|Rubber duck debugging|Flat Earth|Gnome|Garden gnome',
  ],
  sports: [
    'Football|Olympic Games|Basketball|Tennis|Cricket|Baseball|FIFA World Cup|Chess|Video game|Formula One|Boxing|Golf',
    'Cristiano Ronaldo|Lionel Messi|Michael Jordan|Usain Bolt|Muhammad Ali|Zinedine Zidane|Riyad Mahrez|Roger Federer|Serena Williams|Tour de France|Super Bowl|UEFA Champions League|Wimbledon Championships|Marathon|Rugby union|Ice hockey|Volleyball|Table tennis|Minecraft|Super Mario|Tetris|Pokémon|The Legend of Zelda|Pac-Man|Fortnite|Monopoly (game)|Scrabble|Lego|Rubik\'s Cube|Poker',
    'Sepak takraw|Underwater hockey|Cheese rolling|Wife-carrying|Bossaball|Curling|Sumo|Parkour|Quidditch (real-life sport)|Kabaddi|Hurling|Jai alai|Bowling|Darts|Mahjong|Go (game)|Backgammon|Sudoku|Tamagotchi|Yo-yo|Frisbee|Boomerang|Tarot|Kite flying|Bobsleigh|Skeleton (sport)|Toe wrestling|Extreme ironing|Chess boxing|Tug of war',
  ],
  tech: [
    'Internet|Computer|Engineering|Car|Telephone|Television|Airplane|Train|Computer science|Electricity|Printing press|Steam engine|Radio|Satellite|Robot|Artificial intelligence',
    'Apple Inc.|Google|Microsoft|Amazon (company)|Tesla, Inc.|Facebook|YouTube|Wikipedia|IPhone|Bitcoin|Steve Jobs|Bill Gates|Linux|Smartphone|World Wide Web|Email|Bicycle|Submarine|Rocket|International Space Station|Nuclear power|Solar power|Wind turbine|Video game console|Laser|GPS|Wi-Fi|Transistor|Alan Turing|Ada Lovelace',
    'Toaster|Paper clip|Zipper|Stapler|Velcro|Bubble wrap|Post-it Note|Lava lamp|Enigma machine|Abacus|Slide rule|Sundial|Hourglass|Compass|Periscope|Hot air balloon|Airship|Segway|Hovercraft|Monorail|Lighthouse|Windmill|Trebuchet|Catapult|Gunpowder|Fireworks|Neon|Floppy disk|Cassette tape|Fax|Pager|Typewriter|Jacquard machine|QWERTY',
  ],
  food: [
    'Food|Bread|Rice|Wine|Beer|Coffee|Tea|Cheese|Chocolate|Meat|Fruit|Vegetable|Agriculture|Sugar|Salt',
    'Pizza|Sushi|Hamburger|Banana|Potato|Honey|Pasta|Ice cream|Apple|Tomato|Olive oil|Corn|Milk|Egg as food|Hot dog|French fries|Croissant|Bagel|Ketchup|Popcorn|Avocado|Taco|Curry|Dumpling|Pancake|Couscous|Tagine|Falafel|Hummus|Paella|Kebab|Baklava|Mint tea|Dates (fruit)|Saffron',
    'Wasabi|Fortune cookie|Marshmallow|Durian|Kimchi|Vegemite|Haggis|Surströmming|Casu martzu|Balut|Century egg|Natto|Tabasco sauce|Twinkie|Spam (food)|Nutella|Jelly Belly|Chewing gum|Pop Rocks|Cotton candy|Hardtack|Garum|Mead|Kombucha|Absinthe|Ghost pepper|Black garlic|Makroudh|Chakhchoukha|Rechta',
  ],
  oddities: [
    'Ghost|Magic (supernatural)|Dragon|Pirate|Ninja|Robot|Alien|Vampire|Zombie|Treasure|Superstition|Conspiracy theory',
    'Bermuda Triangle|Loch Ness Monster|Bigfoot|Atlantis|El Dorado|Area 51|Roswell incident|Stonehenge|Pyramids of Giza|Easter Island|Bermuda|Yeti|Kraken|Unicorn|Mermaid|Werewolf|Phoenix (mythology)|Holy Grail|Philosopher\'s stone|Flying Dutchman|Dolly (sheep)|Laika|Hachikō|Mr. Bean|Elvis sightings',
    'Toynbee tiles|Wow! signal|Mary Celeste|Baghdad Battery|Mothman|Chupacabra|Jersey Devil|Bloop|Taos Hum|Max Headroom signal hijacking|Fan death|Spontaneous human combustion|Emu|Rat king|Globster|Crop circle|Boring Billion|Placebo|Hikikomori|Sleep paralysis|Déjà vu|Mandela effect|Bigfoot trap|Stone balancing|Petrichor|Sonder|Tsundoku|Anatidaephobia|Mondegreen|Uncanny valley',
  ],
};

function list(theme: Exclude<ThemeId, 'any'>, tier: 0 | 1 | 2): string[] {
  return CURATED[theme][tier].split('|').map((s) => s.trim()).filter(Boolean);
}

const THEME_IDS = Object.keys(CURATED) as Exclude<ThemeId, 'any'>[];

function tierPool(tiers: (0 | 1 | 2)[], themes: Exclude<ThemeId, 'any'>[] = THEME_IDS): string[] {
  return themes.flatMap((th) => tiers.flatMap((t) => list(th, t)));
}

export interface Pair {
  start: string;
  target: string;
}

function candidateEn(difficulty: Difficulty, theme: ThemeId, rng: () => number): { start: string | null; target: string } {
  const targetThemes = theme === 'any' ? THEME_IDS : [theme];
  const startTheme = pick(THEME_IDS, rng);
  switch (difficulty) {
    case 'easy':
      return { start: pick(tierPool([1, 2], [startTheme]), rng), target: pick(tierPool([0], targetThemes), rng) };
    case 'medium':
      return {
        start: pick(tierPool([1, 2], [startTheme]), rng),
        target: pick(tierPool(theme === 'any' ? [1] : [0, 1], targetThemes), rng),
      };
    case 'hard':
      // null start = a random Wikipedia article.
      return { start: null, target: pick(tierPool(theme === 'any' ? [2] : [1, 2], targetThemes), rng) };
  }
}

async function candidateOther(lang: string, difficulty: Difficulty, rng: () => number): Promise<{ start: string | null; target: string }> {
  const top = await topArticles(lang);
  if (top.length < 50) return { start: null, target: await randomArticle(lang, rng) };
  const slice = (a: number, b: number) => top.slice(a, Math.min(b, top.length));
  switch (difficulty) {
    case 'easy':
      return { start: pick(slice(0, 600), rng), target: pick(slice(0, 120), rng) };
    case 'medium':
      return { start: pick(slice(0, 1000), rng), target: pick(slice(80, 500), rng) };
    case 'hard':
      return { start: null, target: pick(slice(300, 1000), rng) };
  }
}

export async function generatePair(lang: string, difficulty: Difficulty, theme: ThemeId = 'any', rng: () => number = Math.random): Promise<Pair> {
  for (let attempt = 0; attempt < 7; attempt++) {
    const c = candidateEn(difficulty, theme, rng);
    let start = c.start;
    let target: string | null = c.target;
    if (lang !== 'en') {
      const tr = await translateFromEnglish(lang, [c.target, ...(c.start ? [c.start] : [])]);
      target = tr.get(c.target) ?? null;
      start = c.start ? (tr.get(c.start) ?? null) : null;
      if (!target || (c.start && !start)) continue;
    }
    start ??= await randomArticle(lang, rng);
    if (normalizeTitle(start) === normalizeTitle(target)) continue;
    const resolved = await resolveTitles(lang, [start, target]);
    const s = resolved.get(start);
    const t = resolved.get(target);
    if (s && t && s !== t) return { start: s, target: t };
  }
  if (lang !== 'en') {
    for (let attempt = 0; attempt < 3; attempt++) {
      const c = await candidateOther(lang, difficulty, rng);
      const start = c.start ?? (await randomArticle(lang, rng));
      const resolved = await resolveTitles(lang, [start, c.target]);
      const s = resolved.get(start);
      const t = resolved.get(c.target);
      if (s && t && s !== t) return { start: s, target: t };
    }
  }
  throw new HttpError(502, 'Could not pick a pair of pages right now. Please try again.');
}

/** The Daily Challenge pair for a date: deterministic, medium-ish, two different themes. */
export async function dailyCandidate(rng: () => number): Promise<Pair> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const [a, b] = [pick(THEME_IDS, rng), pick(THEME_IDS, rng)];
    if (a === b) continue;
    const start = pick(tierPool([1, 2], [a]), rng);
    const target = pick(tierPool([1], [b]), rng);
    const resolved = await resolveTitles('en', [start, target]);
    const s = resolved.get(start);
    const t = resolved.get(target);
    if (s && t && s !== t) return { start: s, target: t };
  }
  throw new HttpError(502, 'Could not create the daily challenge');
}

export function allCuratedTitles(): string[] {
  return tierPool([0, 1, 2]);
}
