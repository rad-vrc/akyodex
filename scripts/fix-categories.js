const fs = require('fs');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');
const definitions = require('./category-definitions-ja');

const csvPath = process.argv[2] || 'data/akyo-data-ja.csv';

console.log(`Reading CSV from ${csvPath}...`);
const input = fs.readFileSync(csvPath, 'utf8');

const records = parse(input, {
  columns: false,
  relax_quotes: true,
  relax_column_count: true,
  skip_empty_lines: true,
});

const header = records[0];
const categoryIdx = header.findIndex(h => h.trim() === 'Category');
const nicknameIdx = header.findIndex(h => h.trim() === 'Nickname');

if (categoryIdx === -1) {
  console.error('Could not find Category column');
  process.exit(1);
}
if (nicknameIdx === -1) {
  console.error('Could not find Nickname column');
  process.exit(1);
}

console.log('Processing records...');

// 野菜名のリスト（食べ物/野菜/○○に変換するため）- 正規定義から取得
// FOOD_KEYWORDS['野菜']の最初の要素'野菜'を除外（カテゴリ名なので）
const vegetables = definitions.FOOD_KEYWORDS['野菜'].slice(1);

/**
 * 指定した除外リスト以外の動物サブカテゴリが存在するかチェック
 * @param {string[]} categories - カテゴリ配列
 * @param {string[]} excludes - 除外する動物サブカテゴリのリスト（例: ['動物/イカ', '動物/海の生き物']）
 * @returns {boolean} - 他の動物サブカテゴリが存在すればtrue
 */
function hasOtherAnimalCategory(categories, excludes = []) {
  return categories.some(c => c.startsWith('動物/') && !excludes.includes(c));
}

let modifiedCount = 0;
const newRecords = [header];

for (let i = 1; i < records.length; i++) {
  const record = records[i];
  const oldCategory = record[categoryIdx] || '';
  const nickname = record[nicknameIdx] || '';
  
  let categories = oldCategory.replace(/、/g, ',').split(',').map(c => c.trim()).filter(c => c);
  
  // 1. 衣装・職業 → 削除（衣類・衣装と職業・身分に分割）
  // 正規の定義ファイルからキーワードとカテゴリ名を使用
  if (categories.includes('衣装・職業')) {
    categories = categories.filter(c => c !== '衣装・職業');
    // 内容に基づいて適切なカテゴリを追加（正規定義を使用）
    const costumeKeywords = definitions.COSTUME_KEYWORDS;
    const occupationKeywords = definitions.OCCUPATION_KEYWORDS;
    const costumeCategory = definitions.CONFIG.costumeCategory;
    const occupationCategory = definitions.CONFIG.occupationCategory;
    
    const hasCostume = costumeKeywords.some(k => nickname.includes(k));
    const hasOccupation = occupationKeywords.some(k => nickname.includes(k));
    
    if (hasCostume) categories.push(costumeCategory);
    if (hasOccupation) categories.push(occupationCategory);
    // どちらにも該当しない場合、職業として扱う（デフォルト）
    if (!hasCostume && !hasOccupation) categories.push(occupationCategory);
  }
  
  // 2. 神・天使カテゴリを追加、アヌビス系を架空の存在/天使・神に
  // 「ラー」は部分一致で誤検出するため（マフラー、エラー、ラーメン等）、除外パターンを設定
  const godKeywords = ['アヌビス', 'バステト', 'ホルス', 'メジェド', 'ゼウス', 'ポセイドン', 'ハデス', 'オーディン', '後光'];
  const raExcludePatterns = ['マフラー', 'エラー', 'ラーメン', 'カラー', 'ドラー', 'コーラ'];
  const isRaGod = nickname.includes('ラー') && !raExcludePatterns.some(p => nickname.includes(p));
  if (godKeywords.some(k => nickname.includes(k)) || isRaGod) {
    categories = categories.filter(c => c !== '架空の存在/妖怪・おばけ');
    if (!categories.includes('架空の存在')) categories.push('架空の存在');
    if (!categories.includes('架空の存在/天使・神')) categories.push('架空の存在/天使・神');
    // 旧カテゴリを削除
    categories = categories.filter(c => c !== '神' && c !== '架空の存在/神' && c !== '架空の存在/天界');
  }
  
  // 3. スイカAkyoから海の生き物カテゴリを削除（スイカはフルーツであってイカではない）
  // 「スイカ」と「イカ」は別物。「スイカ」にはイカが含まれるので正規表現で判定
  if (/スイカ/.test(nickname)) {
    categories = categories.filter(c => !c.includes('海の生き物') && c !== '動物/イカ');
    // 動物カテゴリも削除（スイカはフルーツなので）
    if (categories.includes('動物') && !hasOtherAnimalCategory(categories, ['動物/海の生き物', '動物/イカ'])) {
      categories = categories.filter(c => c !== '動物');
    }
  }
  
  // 4. アキョベロスを幻獣に修正（妖怪を削除）
  if (nickname.includes('アキョベロス') || nickname.includes('ケルベロス')) {
    categories = categories.filter(c => c !== '架空の存在/妖怪・おばけ');
    if (!categories.includes('架空の存在/幻獣・精霊')) categories.push('架空の存在/幻獣・精霊');
  }
  
  // 5. カーバンクルを精霊に修正（妖怪を削除）
  if (nickname.includes('カーバンクル')) {
    categories = categories.filter(c => c !== '架空の存在/妖怪・おばけ');
    if (!categories.includes('架空の存在/幻獣・精霊')) categories.push('架空の存在/幻獣・精霊');
  }
  
  // 5b. かっぱまきAkyoから妖怪を削除（かっぱ巻きは河童ではなく寿司）
  if (nickname.includes('かっぱまき')) {
    categories = categories.filter(c => c !== '架空の存在/妖怪・おばけ' && c !== '架空の存在');
  }
  
  // 5c. 精霊がついているのにおばけもついている場合はおばけを削除
  if (categories.includes('架空の存在/幻獣・精霊') && categories.includes('架空の存在/妖怪・おばけ')) {
    categories = categories.filter(c => c !== '架空の存在/妖怪・おばけ');
  }
  
  // 5d. 天使系はおばけを削除して架空の存在/天使・神を追加
  if (nickname.includes('天使')) {
    categories = categories.filter(c => c !== '架空の存在/妖怪・おばけ' && c !== '架空の存在/天界');
    if (!categories.includes('架空の存在')) categories.push('架空の存在');
    if (!categories.includes('架空の存在/天使・神')) categories.push('架空の存在/天使・神');
  }
  
  // 5e. amongAkyoをパロディ/Among Usに変更
  if (/among/i.test(nickname)) {
    categories = categories.filter(c => c !== '架空の存在/妖怪・おばけ');
    if (!categories.includes('パロディ')) categories.push('パロディ');
    if (!categories.includes('パロディ/Among Us')) categories.push('パロディ/Among Us');
  }
  
  // 6. 海を自然/海に変更
  if (categories.includes('海')) {
    categories = categories.filter(c => c !== '海');
    if (!categories.includes('自然')) categories.push('自然');
    if (!categories.includes('自然/海')) categories.push('自然/海');
  }
  
  // 7. 富士山Akyoに自然/山を追加
  if (nickname.includes('富士山')) {
    if (!categories.includes('自然')) categories.push('自然');
    if (!categories.includes('自然/山')) categories.push('自然/山');
  }
  
  // 8. 動物/狼を動物/おおかみに統一
  if (categories.includes('動物/狼')) {
    categories = categories.filter(c => c !== '動物/狼');
    if (!categories.includes('動物/おおかみ')) categories.push('動物/おおかみ');
  }
  
  // 9. パンを食べ物/パンに変更
  if (categories.includes('パン')) {
    categories = categories.filter(c => c !== 'パン');
    if (!categories.includes('食べ物')) categories.push('食べ物');
    if (!categories.includes('食べ物/パン')) categories.push('食べ物/パン');
  }
  
  // 10. 寿司を食べ物/お寿司に変更
  if (categories.includes('寿司')) {
    categories = categories.filter(c => c !== '寿司');
    if (!categories.includes('食べ物')) categories.push('食べ物');
    if (!categories.includes('食べ物/お寿司')) categories.push('食べ物/お寿司');
  }
  
  // 11. のみものを飲み物に統一
  if (categories.includes('のみもの')) {
    categories = categories.filter(c => c !== 'のみもの');
    if (!categories.includes('飲み物')) categories.push('飲み物');
  }
  
  // 12. 素材・材質を素材・材質・生地に変更
  categories = categories.map(c => {
    if (c === '素材・材質') return '素材・材質・生地';
    if (c.startsWith('素材・材質/')) return c.replace('素材・材質/', '素材・材質・生地/');
    return c;
  });
  
  // 13. 生地を素材・材質・生地に変更
  if (categories.includes('生地')) {
    categories = categories.filter(c => c !== '生地');
    if (!categories.includes('素材・材質・生地')) categories.push('素材・材質・生地');
  }
  
  // 13b. 硬い・柔らかいを素材・材質・生地/硬い、素材・材質・生地/柔らかいに階層化
  if (categories.includes('硬い')) {
    categories = categories.filter(c => c !== '硬い');
    if (!categories.includes('素材・材質・生地')) categories.push('素材・材質・生地');
    if (!categories.includes('素材・材質・生地/硬い')) categories.push('素材・材質・生地/硬い');
  }
  if (categories.includes('柔らかい')) {
    categories = categories.filter(c => c !== '柔らかい');
    if (!categories.includes('素材・材質・生地')) categories.push('素材・材質・生地');
    if (!categories.includes('素材・材質・生地/柔らかい')) categories.push('素材・材質・生地/柔らかい');
  }
  
  // 14. 家電と家具の単体カテゴリを削除（家電・家具に統一）
  if (categories.includes('家電')) {
    categories = categories.filter(c => c !== '家電');
    if (!categories.includes('家電・家具')) categories.push('家電・家具');
  }
  if (categories.includes('家具')) {
    categories = categories.filter(c => c !== '家具');
    if (!categories.includes('家電・家具')) categories.push('家電・家具');
  }
  
  // 14b. 合体と変身を合体・変身に統一
  if (categories.includes('合体')) {
    categories = categories.filter(c => c !== '合体');
    if (!categories.includes('合体・変身')) categories.push('合体・変身');
  }
  if (categories.includes('変身')) {
    categories = categories.filter(c => c !== '変身');
    if (!categories.includes('合体・変身')) categories.push('合体・変身');
  }
  
  // 14c. なりきりと仮装をファッション・装備/なりきり・仮装に統一
  if (categories.includes('なりきり')) {
    categories = categories.filter(c => c !== 'なりきり');
    if (!categories.includes('ファッション・装備')) categories.push('ファッション・装備');
    if (!categories.includes('ファッション・装備/なりきり・仮装')) categories.push('ファッション・装備/なりきり・仮装');
  }
  if (categories.includes('仮装')) {
    categories = categories.filter(c => c !== '仮装');
    if (!categories.includes('ファッション・装備')) categories.push('ファッション・装備');
    if (!categories.includes('ファッション・装備/なりきり・仮装')) categories.push('ファッション・装備/なりきり・仮装');
  }
  if (categories.includes('なりきり・仮装')) {
    categories = categories.filter(c => c !== 'なりきり・仮装');
    if (!categories.includes('ファッション・装備')) categories.push('ファッション・装備');
    if (!categories.includes('ファッション・装備/なりきり・仮装')) categories.push('ファッション・装備/なりきり・仮装');
  }
  
  // 15. 野菜系を食べ物/野菜/○○に階層化
  vegetables.forEach(veg => {
    if (categories.includes(veg)) {
      categories = categories.filter(c => c !== veg);
      if (!categories.includes('食べ物')) categories.push('食べ物');
      if (!categories.includes('食べ物/野菜')) categories.push('食べ物/野菜');
      if (!categories.includes(`食べ物/野菜/${veg}`)) categories.push(`食べ物/野菜/${veg}`);
    }
  });
  
  // 16. 重複カテゴリの削除
  // 材質単体を削除（素材・材質・生地に統合済み）
  if (categories.includes('材質')) {
    categories = categories.filter(c => c !== '材質');
    if (!categories.includes('素材・材質・生地')) categories.push('素材・材質・生地');
  }
  
  // コーヒーを飲み物に統合
  if (categories.includes('コーヒー')) {
    categories = categories.filter(c => c !== 'コーヒー');
    if (!categories.includes('飲み物')) categories.push('飲み物');
  }
  
  // ラムネを飲み物に統合
  if (categories.includes('ラムネ')) {
    categories = categories.filter(c => c !== 'ラムネ');
    if (!categories.includes('飲み物')) categories.push('飲み物');
    if (!categories.includes('食べ物/スイーツ')) categories.push('食べ物/スイーツ');
  }
  
  // 果実を食べ物/フルーツに統合
  if (categories.includes('果実')) {
    categories = categories.filter(c => c !== '果実');
    if (!categories.includes('食べ物')) categories.push('食べ物');
    if (!categories.includes('食べ物/フルーツ')) categories.push('食べ物/フルーツ');
  }
  
  // おばけを架空の存在/妖怪・おばけに統合
  if (categories.includes('おばけ')) {
    categories = categories.filter(c => c !== 'おばけ');
    if (!categories.includes('架空の存在')) categories.push('架空の存在');
    if (!categories.includes('架空の存在/妖怪・おばけ')) categories.push('架空の存在/妖怪・おばけ');
  }
  
  // 精霊単体を削除（架空の存在/幻獣・精霊に移行済み）
  // 架空の存在/幻獣・精霊がある場合は精霊単体を削除
  if (categories.includes('精霊') && categories.includes('架空の存在/幻獣・精霊')) {
    categories = categories.filter(c => c !== '精霊');
  }
  // 精霊単体のみの場合は架空の存在/幻獣・精霊に変換
  if (categories.includes('精霊') && !categories.includes('架空の存在/幻獣・精霊') && !categories.includes('精霊馬')) {
    categories = categories.filter(c => c !== '精霊');
    if (!categories.includes('架空の存在')) categories.push('架空の存在');
    categories.push('架空の存在/幻獣・精霊');
  }
  // 精霊馬がある場合は精霊単体を削除（精霊馬は季節・行事関連）
  if (categories.includes('精霊馬') && categories.includes('精霊')) {
    categories = categories.filter(c => c !== '精霊');
  }
  
  // キュウリを食べ物/野菜/きゅうりに変換
  if (categories.includes('キュウリ')) {
    categories = categories.filter(c => c !== 'キュウリ');
    if (!categories.includes('食べ物')) categories.push('食べ物');
    if (!categories.includes('食べ物/野菜')) categories.push('食べ物/野菜');
    if (!categories.includes('食べ物/野菜/きゅうり')) categories.push('食べ物/野菜/きゅうり');
  }
  
  // ナスビを食べ物/野菜/ナスに変換
  if (categories.includes('ナスビ')) {
    categories = categories.filter(c => c !== 'ナスビ');
    if (!categories.includes('食べ物')) categories.push('食べ物');
    if (!categories.includes('食べ物/野菜')) categories.push('食べ物/野菜');
    if (!categories.includes('食べ物/野菜/ナス')) categories.push('食べ物/野菜/ナス');
  }
  
  // 揚げ物を食べ物/料理/揚げ物に変換
  if (categories.includes('揚げ物')) {
    categories = categories.filter(c => c !== '揚げ物');
    if (!categories.includes('食べ物')) categories.push('食べ物');
    if (!categories.includes('食べ物/料理')) categories.push('食べ物/料理');
    if (!categories.includes('食べ物/料理/揚げ物')) categories.push('食べ物/料理/揚げ物');
  }
  
  // タコスを食べ物/料理に変換（タコではない）
  if (categories.includes('タコス')) {
    categories = categories.filter(c => c !== 'タコス');
    if (!categories.includes('食べ物')) categories.push('食べ物');
    if (!categories.includes('食べ物/料理')) categories.push('食べ物/料理');
    // タコスはタコではないので、動物/タコを削除
    categories = categories.filter(c => c !== '動物/タコ');
    // 他の動物カテゴリがなければ動物と海の生き物も削除
    if (!hasOtherAnimalCategory(categories, ['動物/海の生き物', '動物/タコ'])) {
      categories = categories.filter(c => c !== '動物' && c !== '動物/海の生き物');
    }
  }
  
  // りゅう・ドラゴンを架空の存在/りゅう・ドラゴンに統合
  if (categories.includes('りゅう・ドラゴン')) {
    categories = categories.filter(c => c !== 'りゅう・ドラゴン');
    if (!categories.includes('架空の存在')) categories.push('架空の存在');
    if (!categories.includes('架空の存在/りゅう・ドラゴン')) categories.push('架空の存在/りゅう・ドラゴン');
  }
  
  // お肉を食べ物/お肉に階層化
  if (categories.includes('お肉')) {
    categories = categories.filter(c => c !== 'お肉');
    if (!categories.includes('食べ物')) categories.push('食べ物');
    if (!categories.includes('食べ物/お肉')) categories.push('食べ物/お肉');
  }
  
  // お弁当を食べ物/お弁当に階層化
  if (categories.includes('お弁当')) {
    categories = categories.filter(c => c !== 'お弁当');
    if (!categories.includes('食べ物')) categories.push('食べ物');
    if (!categories.includes('食べ物/お弁当')) categories.push('食べ物/お弁当');
  }
  
  // ミャクミャクの神を架空の存在/天使・神に変換
  if (nickname.includes('ミャクミャク') && categories.includes('神')) {
    categories = categories.filter(c => c !== '神');
    if (!categories.includes('架空の存在')) categories.push('架空の存在');
    if (!categories.includes('架空の存在/天使・神')) categories.push('架空の存在/天使・神');
  }
  
  // 重複削除
  categories = [...new Set(categories)];
  
  const newCategory = categories.join(',');
  if (oldCategory !== newCategory) {
    record[categoryIdx] = newCategory;
    modifiedCount++;
    console.log(`Modified: ${nickname}: ${oldCategory} -> ${newCategory}`);
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
