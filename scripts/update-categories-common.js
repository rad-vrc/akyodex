const fs = require('fs');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');

function createCategoryProcessor(definitions) {
  const {
    MAJOR_ANIMALS,
    MARINE_LIFE,
    FOOD_KEYWORDS,
    FICTIONAL_KEYWORDS,
    MATERIAL_KEYWORDS,
    APPLIANCE_KEYWORDS,
    PLANT_KEYWORDS,
    OCCUPATION_KEYWORDS,
    COSTUME_KEYWORDS,
    SEASON_KEYWORDS,
    MUSIC_KEYWORDS,
    TOOL_KEYWORDS,
    BATH_KEYWORDS,
    SCHOOL_KEYWORDS,
    NATURE_KEYWORDS,
    HISTORY_KEYWORDS,
    BODY_KEYWORDS,
    ART_KEYWORDS,
    CONFIG
  } = definitions;

  return function processCategories(categoryStr, nickname) {
    if (!categoryStr) categoryStr = '';
    let categories = categoryStr.replace(/、/g, ',').split(',').map(c => c.trim()).filter(c => c);

    // --- 1. Pre-processing & Merging ---
    
    CONFIG.mergeMappings.forEach(mapping => {
      categories = categories.map(c => mapping.from.includes(c) ? mapping.to : c);
    });

    if (categories.includes(CONFIG.renameFish.from)) {
      categories = categories.filter(c => c !== CONFIG.renameFish.from);
      CONFIG.renameFish.to.forEach(c => categories.push(c));
    }

    // --- 2. Keyword-based Categorization ---
    
    const addCat = (cat) => { if (!categories.includes(cat)) categories.push(cat); };
    const matches = (keywords, text) => {
      return keywords.some(k => {
        if (k instanceof RegExp) return k.test(text);
        return text.includes(k);
      });
    };

    // Food Logic
    for (const [subCat, keywords] of Object.entries(FOOD_KEYWORDS)) {
      if (matches(keywords, nickname) || keywords.some(k => typeof k === 'string' && categories.includes(k))) {
        const subCatConfig = CONFIG.foodSubCategories[subCat] || CONFIG.foodSubCategories['default'];
        
        if (subCatConfig.exclude) {
          addCat(subCatConfig.category);
          categories = categories.filter(c => c !== subCatConfig.exclude);
        } else if (subCatConfig.prefix) {
          addCat(subCatConfig.category);
          addCat(`${subCatConfig.prefix}${subCat}`);
        } else {
          addCat(subCatConfig.category);
        }
      }
    }
    
    if (CONFIG.tofuGyozaKeywords.some(k => nickname.includes(k))) {
      const defaultConfig = CONFIG.foodSubCategories['default'];
      addCat(defaultConfig.category);
      const dishKey = Object.keys(FOOD_KEYWORDS).find(k => k === 'Dish' || k === '料理');
      if (dishKey) addCat(`${defaultConfig.prefix}${dishKey}`);
    }

    categories = categories.map(c => {
      if (CONFIG.foodPrefixes.includes(c)) return `${CONFIG.foodSubCategories['default'].prefix}${c}`;
      return c;
    });
    if (categories.some(c => c.startsWith(CONFIG.foodSubCategories['default'].prefix))) addCat(CONFIG.foodSubCategories['default'].category);

    // Mint Chocolate Exception
    if (categories.includes(CONFIG.mintChocoKeyword)) {
      categories = categories.filter(c => !c.startsWith(CONFIG.foodSubCategories['default'].category));
    }

    // Onion Exception (Fix for previous misclassification)
    if (nickname.match(/Onion/i) && !nickname.match(/\bOni\b/i)) {
       const { remove, checkPrefix, parent } = CONFIG.onionExclusions;
       categories = categories.filter(c => c !== remove);
       // If no other Fictional Being subcategories remain, remove Fictional Being too
       const hasOtherFictional = categories.some(c => c.startsWith(checkPrefix) && c !== remove);
       if (!hasOtherFictional) {
           categories = categories.filter(c => c !== parent);
       }
    }

    // Animal Logic
    if (matches(MARINE_LIFE, nickname) || MARINE_LIFE.some(k => typeof k === 'string' && categories.includes(k))) {
      addCat(CONFIG.animalCategory);
      addCat(CONFIG.marineLifeCategory);
    }

    MAJOR_ANIMALS.forEach(animal => {
      if (nickname.includes(animal) || categories.includes(animal)) {
        addCat(CONFIG.animalCategory);
        addCat(`${CONFIG.animalCategory}/${animal}`);
      }
    });
    
    if (nickname.includes(CONFIG.animalCategory) || categories.includes(CONFIG.animalCategory)) {
      addCat(CONFIG.animalCategory);
    }
    
    // Fictional Logic
    CONFIG.specificFictionalKeywords.forEach(item => {
      if (nickname.includes(item.keyword)) {
        item.categories.forEach(c => addCat(c));
      }
    });

    for (const [subCat, keywords] of Object.entries(FICTIONAL_KEYWORDS)) {
      if (matches(keywords, nickname) || keywords.some(k => typeof k === 'string' && categories.includes(k))) {
        addCat(CONFIG.fictionalCategory);
        addCat(`${CONFIG.fictionalCategory}/${subCat}`);
      }
    }

    // Material Logic
    CONFIG.specificMaterialKeywords.forEach(item => {
      if (nickname.includes(item.keyword)) {
        item.categories.forEach(c => addCat(c));
      }
    });

    if (categories.includes(CONFIG.stoneKeyword) || nickname.includes(CONFIG.stoneKeyword)) {
      if (categories.includes(CONFIG.stoneKeyword)) {
        categories = categories.filter(c => c !== CONFIG.stoneKeyword);
        CONFIG.stoneCategories.forEach(c => addCat(c));
      }
    }
    for (const [subCat, keywords] of Object.entries(MATERIAL_KEYWORDS)) {
      if (matches(keywords, nickname) || keywords.some(k => typeof k === 'string' && categories.includes(k))) {
        addCat(CONFIG.materialCategory);
        if (subCat !== 'Other' && subCat !== 'その他') addCat(`${CONFIG.materialCategory}/${subCat}`);
      }
    }

    // Special/Effects
    if (matches(CONFIG.specialEffectKeywords, nickname)) {
      const gimmickMapping = CONFIG.mergeMappings.find(m => m.to === 'Gimmick・Special' || m.to === 'ギミック・特殊');
      if (gimmickMapping) addCat(gimmickMapping.to);
    }
    if (nickname.includes(CONFIG.rainbowKeyword)) {
      addCat(CONFIG.rainbowCategory);
    }

    // Appliances/Furniture
    if (matches(APPLIANCE_KEYWORDS, nickname)) {
      addCat(CONFIG.applianceCategory);
    }

    // Plant
    if (matches(PLANT_KEYWORDS, nickname)) {
      addCat(CONFIG.plantParentCategory);
      addCat(CONFIG.plantCategory);
    }

    // Occupation
    if (matches(OCCUPATION_KEYWORDS, nickname)) {
      addCat(CONFIG.occupationCategory);
    }

    // Costume
    if (matches(COSTUME_KEYWORDS, nickname)) {
      addCat(CONFIG.costumeCategory);
    }

    // Season/Event
    if (matches(SEASON_KEYWORDS, nickname)) {
      addCat(CONFIG.seasonCategory);
    }

    // Music
    if (matches(MUSIC_KEYWORDS, nickname)) {
      addCat(CONFIG.musicCategory);
    }

    // Tool
    if (matches(TOOL_KEYWORDS, nickname)) {
      addCat(CONFIG.toolCategory);
    }

    // Bath
    if (matches(BATH_KEYWORDS, nickname)) {
      addCat(CONFIG.bathCategory);
    }

    // School
    if (matches(SCHOOL_KEYWORDS, nickname)) {
      addCat(CONFIG.schoolCategory);
    }

    // Nature
    if (matches(NATURE_KEYWORDS, nickname)) {
      addCat(CONFIG.natureCategory);
    }

    // History
    if (matches(HISTORY_KEYWORDS, nickname)) {
      addCat(CONFIG.historyCategory);
    }

    // Body Type
    if (matches(BODY_KEYWORDS, nickname)) {
      addCat(CONFIG.bodyCategory);
    }

    // Art
    if (matches(ART_KEYWORDS, nickname)) {
      addCat(CONFIG.artCategory);
    }
    if (nickname.includes(CONFIG.realKeyword)) {
      addCat(CONFIG.realCategory);
    }

    // --- 3. Cleanup & Deduplication ---
    
    if (categories.length > 1 && categories.includes(CONFIG.uncategorized)) {
      categories = categories.filter(c => c !== CONFIG.uncategorized);
    }
    
    categories = categories.filter(c => c);

    const result = [...new Set(categories)].join(',');
    return result || CONFIG.uncategorized;
  };
}

function updateCsv(csvPath, definitions) {
  console.log(`Reading CSV from ${csvPath}...`);
  const input = fs.readFileSync(csvPath, 'utf8');
  
  // Relaxed parsing options with validation as requested
  const records = parse(input, {
    columns: false,
    relax_quotes: true, // Allow quotes inside unquoted fields (common in user data)
    relax_column_count: true, // Allow inconsistent column counts (common in user data)
    skip_empty_lines: true,
  });

  const header = records[0];
  const categoryIdx = header.findIndex(h => h.trim() === 'Category');
  const nicknameIdx = header.findIndex(h => h.trim() === 'Nickname');

  if (categoryIdx === -1 || nicknameIdx === -1) {
    console.error('Could not find Category or Nickname column');
    process.exit(1);
  }

  // Post-parse validation
  const expectedColumnCount = header.length;
  records.forEach((record, index) => {
    if (record.length !== expectedColumnCount) {
      console.warn(`Warning: Row ${index + 1} has ${record.length} columns, expected ${expectedColumnCount}.`);
    }
  });

  console.log('Processing records...');
  const processCategories = createCategoryProcessor(definitions);
  const newRecords = [header];
  let modifiedCount = 0;

  for (let i = 1; i < records.length; i++) {
    const record = records[i];
    const oldCategory = record[categoryIdx];
    const nickname = record[nicknameIdx];
    
    const newCategory = processCategories(oldCategory, nickname);
    
    if (oldCategory !== newCategory) {
      record[categoryIdx] = newCategory;
      modifiedCount++;
    }
    newRecords.push(record);
  }

  console.log(`Modified ${modifiedCount} records.`);

  console.log('Writing CSV...');
  const output = stringify(newRecords, {
    quoted: true,
  });
  
  fs.writeFileSync(csvPath, output);
  console.log('Done.');
}

module.exports = {
  createCategoryProcessor,
  updateCsv
};
