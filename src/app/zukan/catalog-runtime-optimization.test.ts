import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const projectRoot = new URL("../../../", import.meta.url);
const zukanClientSource = readFileSync(
  new URL("src/app/zukan/zukan-client.tsx", projectRoot),
  "utf8",
);
const useAkyoDataSource = readFileSync(
  new URL("src/hooks/use-akyo-data.ts", projectRoot),
  "utf8",
);
const akyoCardSource = readFileSync(
  new URL("src/components/akyo-card.tsx", projectRoot),
  "utf8",
);

test("complete catalog loading records and splits search-index preparation before state application", () => {
  assert.match(zukanClientSource, /phaseRecorder:\s*catalogPerformance/);
  assert.match(
    zukanClientSource,
    /startPhase\(["']search-index["']\)[\s\S]*prepareCatalogItemsInChunks\(result\.items,\s*\{\s*signal:\s*request\.signal/,
  );
  assert.match(
    zukanClientSource,
    /preparedItems\s*=\s*sortCatalogForDisplay\(/,
  );
  assert.match(
    zukanClientSource,
    /startPhase\(["']state-apply["']\)[\s\S]*startTransition/,
  );
  assert.match(
    zukanClientSource,
    /endPhase\(["']state-apply["']\)[\s\S]*markReady/,
  );
});

test("full-catalog favorite hydration reuses equivalent initial card references", () => {
  assert.match(
    useAkyoDataSource,
    /applyFavoritesToPreparedCatalog\([\s\S]*previousItems/,
  );
  assert.match(
    useAkyoDataSource,
    /applyFavoritesFromIds\([\s\S]*dataRef\.current/,
  );
  assert.match(
    useAkyoDataSource,
    /haveSameCatalogItemReferences\(filteredDataRef\.current, filtered\)/,
  );
});

test("catalog cards are memoized and receive a stable detail callback", () => {
  assert.match(akyoCardSource, /export const AkyoCard = memo\(AkyoCardComponent\)/);
  assert.match(
    zukanClientSource,
    /const handleShowDetail = useCallback\([\s\S]*modalTriggerRef\.current/,
  );
});
