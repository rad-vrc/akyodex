#!/usr/bin/env node

/**
 * Sync `data/akyo-data-en.csv` to match `data/akyo-data-ja.csv` (ID set + Category),
 * translating categories token-by-token via `scripts/category-ja-en-map.js`.
 *
 * - Japanese CSV is treated as source of truth for:
 *   - row existence / order
 *   - AvatarName, Author, AvatarURL
 *   - Category (translated)
 * - English CSV is treated as source of truth for:
 *   - Nickname, Comment (when present)
 *
 * For newly added Japanese rows (missing in English CSV), Nickname/Comment are filled
 * by the overrides below (and otherwise fall back to Japanese values with a warning).
 */

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');
const categoryMap = require('./category-ja-en-map');

const rootDir = path.resolve(__dirname, '..');
const jaPath = path.join(rootDir, 'data', 'akyo-data-ja.csv');
const enPath = path.join(rootDir, 'data', 'akyo-data-en.csv');

const overridesById = {
  '0640': { Nickname: 'Bean Kappa Akyo', Comment: 'Cucumber, please.' },
  '0641': { Nickname: 'Bean Akyo', Comment: '' },
  '0642': { Nickname: 'Epli Akyo', Comment: '' },
  '0643': { Nickname: 'Kappa Maki Akyo', Comment: 'It seems to be made with fresh cucumbers.' },
  '0644': { Nickname: 'Kiwi Akyo 2', Comment: '' },
  '0645': { Nickname: 'One-piece Fox Akyo 2025', Comment: '' },
  '0646': { Nickname: 'Spotting Look Akyo', Comment: '' },
  '0647': { Nickname: 'Western Fox Akyo', Comment: '' },
  '0648': { Nickname: 'Pine Cone Akyo', Comment: '' },
  '0649': { Nickname: 'Salmon Akyo', Comment: '' },
  '0650': { Nickname: 'U Akyo', Comment: '' },
  '0651': { Nickname: 'Stingray Akyo', Comment: '' },
  '0652': { Nickname: 'Peach Akyo', Comment: '' },
  '0653': { Nickname: 'Hash Akyo', Comment: '' },
  '0654': { Nickname: 'Anti Floating-Point Akyo', Comment: '' },
  '0655': { Nickname: 'Clione Akyo', Comment: '' },
  '0656': { Nickname: 'Soga Plateau Akyo', Comment: '' },
  '0657': { Nickname: 'Crocodile Akyo', Comment: '' },
  '0658': { Nickname: 'Rune Akyo', Comment: '' },
  '0659': { Nickname: 'Halloween Fox Akyo 2025', Comment: '' },
  '0660': { Nickname: 'Masked Wolf Akyo', Comment: '' },
  '0661': { Nickname: 'Fly Agaric Akyo', Comment: '' },
  '0662': { Nickname: 'Halloween Maid Fox Akyo', Comment: '' },
  '0663': { Nickname: 'Doctor Dragon Akyo', Comment: '' },
  '0664': { Nickname: 'Halloween Carrot Akyo', Comment: '' },
  '0665': { Nickname: 'Onion Akyo', Comment: '' },
  '0666': { Nickname: 'Look Akyo?', Comment: '' },
  '0667': { Nickname: 'Lunch Charm Akyo', Comment: '' },
  '0668': { Nickname: 'Cold Akyo', Comment: '' },
  '0669': { Nickname: 'Human-faced Akyo', Comment: '' },
  '0670': { Nickname: 'Ear Akyo', Comment: '' },
  '0671': { Nickname: 'Multi-Eared Akyo', Comment: '' },
  '0672': { Nickname: 'Face Akyo', Comment: '' },
  '0673': { Nickname: 'Agyo', Comment: '' },
  '0674': {
    Nickname: 'Sea Turtle Akyo',
    Comment:
      'It lives in warm seas and is often seen swimming around coral reefs. It also seems to come ashore and take walks along sandy beaches.',
  },
  '0675': {
    Nickname: 'Akyo S',
    Comment: 'A mysterious Akyo discovered beyond the sea. Its ecology is shrouded in mystery.',
  },
  '0676': {
    Nickname: 'Akyo J',
    Comment: 'A mysterious Akyo discovered beyond the sea. Its ecology is shrouded in mystery.',
  },
  '0677': {
    Nickname: 'Rainbow Akyo',
    Comment:
      'On a rainy day, it was captured on video by a TV crew, bringing its existence into the public eye.',
  },
  '0678': { Nickname: 'Rain Akyo', Comment: "There's a rumor it appears on rainy days. The credibility is quite low." },
  '0679': { Nickname: 'Uro Akyo', Comment: 'Seeking information.' },
  '0699': {
    Nickname: 'Year of the Horse Akyo / New Year Horse Akyo',
    Comment: 'A horse Akyo dressed in New Year attire. It seems very excited.',
  },
  '0700': {
    Nickname: 'Duck-and-Green-Onion Akyo',
    Comment: 'A duck Akyo carrying a green onion Akyo. Where did they meet?',
  },
  '0701': {
    Nickname: 'Diamond Akyo',
    Category: 'Material・Texture,Material・Texture/Stone,Hard',
    Comment: '',
  },
  '0702': { Nickname: 'Fox Bean Akyo', Comment: '' },
  '0703': { Nickname: 'Cheese Akyo', Comment: '' },
  '0704': {
    Nickname: 'RGB Dance Akyo',
    Comment: 'It seems to be an Akyo that has mastered dance.',
  },
  '0705': {
    Nickname: 'Cosmic Akyo',
    Comment: 'It seems to have undergone unique evolution for outer-space exploration.',
  },
  '0706': { Nickname: 'Crystal Akyo', Comment: 'Is it a rare Akyo, or...?' },
  '0707': { Nickname: 'Red Team Akyo', Comment: "It's on the red team." },
  '0708': { Nickname: 'Blue Team Akyo', Comment: "It's on the blue team. Very blue." },
  '0709': { Nickname: 'Astral Akyo', Comment: 'Akyo?' },
  '0710': { Nickname: 'Holographic Akyo', Comment: 'The rarest of the rare!' },
  '0711': { Nickname: 'Queen Akyo', Comment: "Apparently it's slippery!" },
  '0712': {
    Nickname: "Kitsunetsuki's Snow Fox Akyo",
    Comment: 'It is said to have been discovered on an icy planet.',
  },
  '0713': { Nickname: "Kitsunetsuki's Golden Fox Akyo", Comment: "It's made of pure gold!" },
  '0714': { Nickname: "Kitsunetsuki's Red Gummy Fox Akyo", Comment: 'Delicious!' },
  '0715': { Nickname: "Kitsunetsuki's Blue Gummy Fox Akyo", Comment: 'This one is delicious too!' },
  '0716': { Nickname: "Kitsunetsuki's Punk Fox Akyo", Comment: 'So punk!' },
  '0717': { Nickname: "Kitsunetsuki's Red Gem Fox Akyo", Comment: 'Apparently it ate too many gems!' },
  '0718': { Nickname: "Kitsunetsuki's Purple Gem Fox Akyo", Comment: 'This one also ate too many gems!' },
  '0719': {
    Nickname: "Kitsunetsuki's White Gem Fox Akyo",
    Comment: "I wonder if Kitsunetsuki's Fox Akyo's favorite food is gems?",
  },
  '0720': {
    Nickname: "Kitsunetsuki's Aluminum Fox Akyo",
    Comment: 'Maybe this Akyo was born within the last 200 years?',
  },
  '0721': { Nickname: "Kitsunetsuki's Ethereal Fox Akyo", Comment: 'I can feel an incredible power...' },
  '0722': {
    Nickname: 'Electric Heater Akyo',
    Comment:
      "(Sasanoki's notes)\r\nAn Akyo that keeps you warm. It seems fine even without being plugged in. It dislikes water because it rusts.",
  },
  '0723': {
    Nickname: 'Yaki Mochi Akyo',
    Comment:
      "(Sasanoki's notes)\r\nA properly grilled square mochi wrapped in nori. Its savory aroma stimulates the appetite.",
  },
  '0724': {
    Nickname: 'Permafrost Akyo',
    Comment:
      "(Sasanoki's notes)\r\nAn ice Akyo discovered during permafrost research. It feels like something is buried inside.",
  },
  '0725': { Nickname: 'Otter Akyo', Comment: "(Sasanoki's notes)\r\nFriendly and very curious." },
  '0726': { Nickname: 'Impostor Akyo', Comment: 'From a distance, it looks like Akyo!' },
  '0727': { Nickname: 'Mohawk Akyo', Comment: "(Sasanoki's notes)\r\nAn Akyo living in the end times." },
  '0728': { Nickname: 'Butter Akyo', Comment: 'I feel like I have seen this butter in VRChat!' },
  '0729': { Nickname: 'Peanuts-kun Akyo', Comment: "I've seen it in an Akyo commercial!" },
  '0730': { Nickname: 'Ponpoko Akyo', Comment: 'This Akyo was in an Akyo commercial too!' },
  '0731': {
    Nickname: 'Forest Nijimasu-man with Moss Akyo',
    Comment: "Look closely, there's a Moss Akyo on its shoulder! It can move on its own too!",
  },
  '0732': {
    Nickname: 'Warrior of Bonds: Axolotlman & Horse Akyo',
    Comment:
      "Even after losing its memory, the flame of its soul still burns fiercely!\r\nCarrying on Mambo Man's will, the Warrior of Bonds, Axolotlman and Horse Akyo, is born here and now, entrusted with the fate of the entire universe!",
  },
  '0733': { Nickname: 'Akyoman / Akyo Head', Comment: 'Its head is Akyo!?\r\nIs it... human?' },
  '0734': { Nickname: 'Reptile Akyo', Comment: "It's the English word for reptiles!" },
  '0735': { Nickname: 'Tanuki Bean Akyo / Bean Tanuki Akyo', Comment: "It's Bean Akyo paradise~~~!!!" },
  '0736': { Nickname: 'Bread Bean Akyo', Comment: 'Bean Akyo paradise keeps growing!' },
  '0737': {
    Nickname: 'Mochi Bean Akyo / Bean Mochi Akyo',
    Comment:
      "The Bean Akyo momentum won't stop!\r\nTurning all Akyo into Bean Akyo might not be just a dream!",
  },
  '0738': { Nickname: 'Fushi Akyo', Comment: 'Follow me! ( ｀ー´)ノ\r\n(from the creator comment)' },
  '0739': { Nickname: 'Akyo (Third Generation)', Comment: 'Gotta catch Akyo!' },
  '0740': {
    Nickname: 'Mammoth Akyo',
    Comment:
      "(Sasanoki's notes)\r\nAn Akyo that had been sleeping in permafrost. It was surprised to wake up and find things had become much warmer.",
  },
  '0741': {
    Nickname: 'Avocado Akyo',
    Comment:
      "(Sasanoki's notes)\r\nHighly nutritious and also called the butter of the forest. Its deliciousness is popular even among Akyo.",
  },
  '0742': {
    Nickname: 'Colorful Spinning Akyo',
    Comment: 'What refined hip moves!',
  },
  '0743': {
    Nickname: 'Octo-Bean Akyo',
    Comment: "Even Octo Akyo has gone bean! They're multiplying fast!",
  },
  '0744': {
    Nickname: 'Red Rust Akyo',
    Comment: "Akyo never dies, even if its body rusts crimson.",
  },
  '0817': { Nickname: 'Black Water Akyo', Comment: '' },
  '0818': { Nickname: 'Bra Akyo', Comment: '' },
  '0819': { Nickname: 'Yellow Akyo with Arms', Comment: '' },
  '0820': { Nickname: 'Machine Akyo', Comment: '' },
  '0821': { Nickname: 'Mama Akyo', Comment: '' },
  '0822': { Nickname: 'Mama Akyo 2', Comment: '' },
  '0823': { Nickname: 'Nico Akyo', Comment: '' },
  '0824': {
    Nickname: 'Fusion Akyo/Flying Akyo',
    Comment: "Agyo's will lives on...",
  },
  '0825': {
    Nickname: 'Forest Fairy Akyo',
    Comment: 'Lucky if you find it!?',
  },
  '0826': {
    Nickname: 'Sunman Akyo',
    Comment: "I feel like I've seen this poster somewhere...",
  },
  '0827': {
    Nickname: '256 Akyo',
    Comment: 'From a distance, it might look like Chocolate Mint Akyo!',
  },
  '0828': {
    Nickname: 'Mermaid Akyo',
    Comment:
      "(Sasanoki's notes)\nAn Akyo adapted to underwater environments. It does not seem to be a strong swimmer and is often washed ashore.",
  },
  '0829': { Nickname: 'Sushi Chef Fox Akyo', Comment: '' },
  '0830': {
    Nickname: 'Yakisoba Bread Akyo',
    Comment:
      "(Sasanoki's notes)\nThe rich aroma of sauce whets the appetite. Carbs on carbs make for a very satisfying meal.",
  },
  '0831': {
    Nickname: 'Pudding Shop Pudding Akyo',
    Comment:
      "(Sasanoki's notes)\nA pudding shop run by Pudding Akyo. The pudding, made with fresh milk from Cow Akyo, is wonderfully rich and irresistibly delicious.",
  },
  '0832': {
    Nickname: 'Shark Hoodie Fox Akyo',
    Comment:
      "(Sasanoki's notes)\nA fox Akyo wearing a shark hoodie. Perfect for relaxing at home or going out.",
  },
  '0833': {
    Nickname: 'Sometimes It Happens Akyo',
    Comment: 'Well, sometimes that happens!',
  },
  '0834': { Nickname: 'roma38 Akyo Avatar Pedestal', Comment: '' },
  '0835': {
    Nickname: 'Cluster Akyo',
    Comment: "Agyo's will lives on...",
  },
  '0836': {
    Nickname: 'Koinobori Akyo',
    Comment: 'May Akyo grow up healthy and strong...',
  },
  '0837': {
    Nickname: 'Matryoshka Akyo',
    Comment: 'You can summon Akyo from the menu!',
  },
  '0838': {
    Nickname: 'Shark Hoodie Shark Akyo',
    Comment:
      "(Sasanoki's notes)\nA shark Akyo wearing a shark hoodie. Maybe it is getting used to life on land?",
  },
  '0839': {
    Nickname: 'Horseshoe Crab Akyo',
    Comment:
      "(Sasanoki's notes)\nIt has a hard shell and lives in calm, shallow seas. It is said to have existed long before the age of dinosaurs and is also called a living fossil.",
  },
  '0840': { Nickname: 'Mochi Bean Akyo', Comment: 'Looks delicious!' },
  '0841': {
    Nickname: 'Sample Akyo',
    Comment: 'It has samples of all kinds of display gimmicks!',
  },
  '0842': {
    Nickname: 'Bulked-Up Akyo',
    Comment: 'The strongest Akyo in the Akyo world is born here and now...',
  },
  '0843': {
    Nickname: 'Sea Otter Akyo',
    Comment:
      "(Sasanoki's notes)\nSea Otter Akyo. It floats along the surface of the sea and often eats shellfish.",
  },
  '0844': {
    Nickname: 'Scientist Akyo',
    Comment:
      "(Sasanoki's notes)\nA very clever Akyo. It seems to be conducting some suspicious research.",
  },
  '0845': {
    Nickname: 'Wandering Rainy-Season Akyo',
    Comment: 'Kappa Akyo would love this!',
  },
  '0846': {
    Nickname: "Can't Be Helped Akyo",
    Comment: 'What could it mean?',
  },
  '0847': {
    Nickname: 'Planet Akyo',
    Comment: "(Sasanoki's notes)\nAkyo was blue.",
  },
  '0848': {
    Nickname: 'Pulse Akyo',
    Comment: "I don't really understand it, but I can feel incredible power!",
  },
  '0849': {
    Nickname: 'Made-in-Akyo',
    Comment: "An Akyo made of Akyo!?\nIt might be Agyo's counterpart.",
  },
  '0850': {
    Nickname: '0.725 Akyo',
    Comment: "It doesn't seem to show up here...\nSee it with your own eyes!",
  },
  '0851': {
    Nickname: 'City Akyo',
    Comment: 'I feel like I can see a city...\nWhich city could it be?',
  },
  '0852': {
    Nickname: 'Fishing Fox Akyo',
    Comment:
      "(Sasanoki's notes)\nA fox Akyo that discovered the joy of fishing. What will it catch today?",
  },
  '0853': {
    Nickname: 'UV Unwrap Akyo',
    Comment: 'Apparently this is what it looks like when UV unwrapped!',
  },
  '0854': {
    Nickname: 'Draw Akyo',
    Comment: 'Maybe we can make an Akyo drawing song!',
  },
  '0855': {
    Nickname: 'Akyo and a Black Hole',
    Comment: 'What!? A black hole behind it!?',
  },
  '0856': {
    Nickname: 'Jitter Akyo',
    Comment: 'It looks like an ordinary Akyo, but...?',
  },
  '0857': {
    Nickname: 'Garden Eel Akyo',
    Comment:
      "(Sasanoki's notes)\nAn Akyo that lives in warm seas. It seems to prefer gentle currents and often plays with tropical fish.",
  },
  '0858': {
    Nickname: 'There? Akyo',
    Comment: 'What? Which one is real??',
  },
  '0859': {
    Nickname: 'Ice Cream Akyo',
    Comment: "There's chocolate mint ice cream too!!",
  },
  '0860': {
    Nickname: 'Desktop Akyo',
    Comment: 'There is another Akyo on the other side.',
  },
  '0861': { Nickname: "Milky's Sky", Comment: '' },
  '0862': { Nickname: 'Akyo Party', Comment: '' },
  '0863': {
    Nickname: 'Curry Cow Akyo',
    Comment: 'I wonder if it contains beef?',
  },
  '0864': {
    Nickname: 'Rusty Akyo',
    Comment:
      "(Sasanoki's notes)\nIts paint has peeled away and its entire body has rusted. Even though all things eventually decay, it still seems lively.",
  },
  '0865': {
    Nickname: 'Security Akyo',
    Comment:
      "(Sasanoki's notes)\nAn Akyo living in a sci-fi world. It can handle dangerous jobs too! Just don't forget that it is still an Akyo.",
  },
  '0866': {
    Nickname: 'Lava Akyo',
    Comment:
      "(Sasanoki's notes)\nAn Akyo born from the core of a planet. It carries ancient heat within its body.",
  },
  '0867': {
    Nickname: 'Takoyaki Akyo',
    Comment:
      "(Sasanoki's notes)\nTakoyaki Akyo, an Osaka specialty. Enjoy it piping hot and freshly cooked!",
  },
  '0868': {
    Nickname: 'Mururu Bean Akyo',
    Comment: "Ah! There's a Mururu Bean Akyo!",
  },
  '0869': {
    Nickname: 'Kitsunetsuki-style Shrine Maiden Fox Akyo',
    Comment: 'A shrine maiden! So cute!',
  },
  '0870': {
    Nickname: 'Duct Tape Akyo',
    Comment: "Don't ever peel it off!",
  },
  '0871': {
    Nickname: 'Sand Akyo',
    Comment: "(Sasanoki's notes)\nAn Akyo born on a sandy beach.",
  },
  '0872': {
    Nickname: 'Chilwa Beneath the Sand',
    Comment: "There's a Kitsunetsuki-style Fox Akyo!",
  },
  '0873': {
    Nickname: 'Hollow Akyo',
    Comment: 'The emptier Akyo is, the more dreams it can hold~♪',
  },
  '0874': {
    Nickname: 'Sasanoki-style Akyo',
    Comment: 'Akyo, so it was you.',
  },
  '0875': {
    Nickname: 'Sasanoki-style Kotatsu Akyo',
    Comment: 'The historic moment when Akyo used a kotatsu for the first time.',
  },
  '0876': {
    Nickname: 'After-the-Rain Bean Akyo',
    Comment: 'Looks like the rainy season is over!',
  },
  '0877': {
    Nickname: 'Kitsunetsuki Laboratory / kitsune_tsuki testing room',
    Comment: 'A laboratory with a Fox Akyo that follows you!',
  },
  '0878': {
    Nickname: 'Home',
    Comment: "There's a Colorful Spinning Akyo!",
  },
};

function parseCsv(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');

  // These CSVs are frequently hand-edited in spreadsheets/editors; we use relaxed parsing to avoid
  // cryptic parser failures from minor formatting issues, then validate the column count ourselves
  // to fail fast with a high-signal error message.
  const records = parse(content, {
    columns: false,
    relax_quotes: true,
    relax_column_count: true,
    skip_empty_lines: true,
    trim: false,
    record_delimiter: ['\r\n', '\n', '\r'],
  });

  if (!records.length) throw new Error(`Empty CSV: ${filePath}`);

  const header = records[0];
  const expectedColumns = header.length;

  for (let i = 0; i < records.length; i += 1) {
    const record = records[i];
    if (record.length !== expectedColumns) {
      throw new Error(
        `CSV column count mismatch in ${filePath} at record index ${i} (expected ${expectedColumns}, got ${record.length}). Record: ${JSON.stringify(
          record,
        )}`,
      );
    }
  }

  return { header, rows: records.slice(1) };
}

function assertCsvRowLengthsMatchHeader({ header, rows }, filePath) {
  const expectedColumns = header.length;
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (row.length !== expectedColumns) {
      throw new Error(
        `CSV row has unexpected column count in ${filePath} at data row #${i + 1} (expected ${expectedColumns}, got ${row.length
        }). Row: ${JSON.stringify(row)}`,
      );
    }
  }
}

function indexOfHeader(header, name) {
  const idx = header.findIndex((h) => String(h).trim() === name);
  if (idx === -1) throw new Error(`Could not find column "${name}" in header: ${header.join(',')}`);
  return idx;
}

function splitTokens(value) {
  return String(value || '')
    .replace(/、/g, ',')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

function normalizeLegacyQuotedCell(value) {
  const text = String(value || '').trim();
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    return text.slice(1, -1).replace(/\\"/g, '"');
  }
  return text;
}

function main() {
  if (!fs.existsSync(jaPath)) throw new Error(`Missing source CSV: ${jaPath}`);
  if (!fs.existsSync(enPath)) throw new Error(`Missing target CSV: ${enPath}`);

  const ja = parseCsv(jaPath);
  const en = parseCsv(enPath);

  // Fail fast if the CSV shapes are inconsistent.
  assertCsvRowLengthsMatchHeader(ja, jaPath);
  assertCsvRowLengthsMatchHeader(en, enPath);

  const outHeader = [...en.header];
  for (const optionalColumn of ['SourceURL', 'EntryType', 'DisplaySerial', 'BoothURL']) {
    if (ja.header.includes(optionalColumn) && !outHeader.includes(optionalColumn)) {
      outHeader.push(optionalColumn);
    }
  }
  const idx = {
    ID: indexOfHeader(outHeader, 'ID'),
    Nickname: indexOfHeader(outHeader, 'Nickname'),
    AvatarName: indexOfHeader(outHeader, 'AvatarName'),
    Category: indexOfHeader(outHeader, 'Category'),
    Comment: indexOfHeader(outHeader, 'Comment'),
    Author: indexOfHeader(outHeader, 'Author'),
    AvatarURL: indexOfHeader(outHeader, 'AvatarURL'),
    SourceURL: outHeader.includes('SourceURL') ? indexOfHeader(outHeader, 'SourceURL') : -1,
    EntryType: outHeader.includes('EntryType') ? indexOfHeader(outHeader, 'EntryType') : -1,
    DisplaySerial:
      outHeader.includes('DisplaySerial') ? indexOfHeader(outHeader, 'DisplaySerial') : -1,
    BoothURL: outHeader.includes('BoothURL') ? indexOfHeader(outHeader, 'BoothURL') : -1,
  };

  const jaIdx = {
    ID: indexOfHeader(ja.header, 'ID'),
    Nickname: indexOfHeader(ja.header, 'Nickname'),
    AvatarName: indexOfHeader(ja.header, 'AvatarName'),
    Category: indexOfHeader(ja.header, 'Category'),
    Comment: indexOfHeader(ja.header, 'Comment'),
    Author: indexOfHeader(ja.header, 'Author'),
    AvatarURL: indexOfHeader(ja.header, 'AvatarURL'),
    SourceURL: ja.header.includes('SourceURL') ? indexOfHeader(ja.header, 'SourceURL') : -1,
    EntryType: ja.header.includes('EntryType') ? indexOfHeader(ja.header, 'EntryType') : -1,
    DisplaySerial:
      ja.header.includes('DisplaySerial') ? indexOfHeader(ja.header, 'DisplaySerial') : -1,
    BoothURL: ja.header.includes('BoothURL') ? indexOfHeader(ja.header, 'BoothURL') : -1,
  };

  const enById = new Map();
  for (const row of en.rows) enById.set(String(row[idx.ID]).trim(), row);

  const missingCategoryTokens = new Set();
  const missingRowTranslations = [];

  const outRows = [outHeader];

  for (const jaRow of ja.rows) {
    const id = String(jaRow[jaIdx.ID]).trim();
    const existingEnRow = enById.get(id);
    const override = overridesById[id];

    const jaTokens = splitTokens(jaRow[jaIdx.Category]);
    const enTokens = jaTokens.map((t) => {
      const mapped = categoryMap[t];
      if (!mapped) missingCategoryTokens.add(t);
      return mapped || t;
    });
    const category = override?.Category ?? enTokens.join(',');

    const jaNickname = normalizeLegacyQuotedCell(jaRow[jaIdx.Nickname]);
    const jaComment = normalizeLegacyQuotedCell(jaRow[jaIdx.Comment]);

    let nickname = existingEnRow ? normalizeLegacyQuotedCell(existingEnRow[idx.Nickname]) : '';
    let comment = existingEnRow ? normalizeLegacyQuotedCell(existingEnRow[idx.Comment]) : '';

    if (override?.Nickname != null && (!nickname || nickname === jaNickname)) {
      nickname = override.Nickname;
    } else if (!nickname) {
      nickname = jaNickname;
    }

    // Normalize line-endings for comparison: the EN CSV uses \r\n record delimiters,
    // so embedded newlines in existing comments may be \r\n while JA uses \n.
    const normalizeEol = (s) => s.replace(/\r\n/g, '\n');
    if (override?.Comment != null && (!comment || normalizeEol(comment) === normalizeEol(jaComment))) {
      comment = override.Comment;
    } else if (!comment) {
      comment = jaComment;
    }

    if (!existingEnRow && !overridesById[id]) missingRowTranslations.push(id);

    const outRow = Array(outHeader.length).fill('');
    outRow[idx.ID] = id;
    outRow[idx.Nickname] = nickname;
    outRow[idx.AvatarName] = String(jaRow[jaIdx.AvatarName] || '');
    outRow[idx.Category] = category;
    outRow[idx.Comment] = comment;
    outRow[idx.Author] = String(jaRow[jaIdx.Author] || '');
    outRow[idx.AvatarURL] = String(jaRow[jaIdx.AvatarURL] || '');
    if (idx.SourceURL >= 0) {
      outRow[idx.SourceURL] =
        jaIdx.SourceURL >= 0
          ? String(jaRow[jaIdx.SourceURL] || jaRow[jaIdx.AvatarURL] || '')
          : String(jaRow[jaIdx.AvatarURL] || '');
    }
    if (idx.EntryType >= 0) {
      outRow[idx.EntryType] = jaIdx.EntryType >= 0 ? String(jaRow[jaIdx.EntryType] || '') : '';
    }
    if (idx.DisplaySerial >= 0) {
      outRow[idx.DisplaySerial] =
        jaIdx.DisplaySerial >= 0 ? String(jaRow[jaIdx.DisplaySerial] || '') : '';
    }
    if (idx.BoothURL >= 0) {
      outRow[idx.BoothURL] =
        jaIdx.BoothURL >= 0
          ? String(jaRow[jaIdx.BoothURL] || '')
          : String(existingEnRow?.[idx.BoothURL] || '');
    }
    outRows.push(outRow);
  }

  if (missingCategoryTokens.size > 0) {
    const tokens = Array.from(missingCategoryTokens).sort();
    throw new Error(
      `Missing category translations (${tokens.length}). Add them to scripts/category-ja-en-map.js:\\n` +
      tokens.map((t) => `- ${t}`).join('\\n'),
    );
  }

  if (missingRowTranslations.length > 0) {
    console.warn(
      `⚠️ Missing Nickname/Comment overrides for new IDs (kept JA values): ${missingRowTranslations.join(', ')}`,
    );
  }

  const outCsv = stringify(outRows, {
    record_delimiter: '\r\n',
    quoted_match: /[\r\n]/,
  });
  fs.writeFileSync(enPath, outCsv, 'utf8');

  console.log(`✅ Synced English CSV: ${path.relative(rootDir, enPath)}`);
  console.log(`   Rows: ${ja.rows.length} (matched Japanese CSV)`);
}

if (require.main === module) main();
