-- Posiłkomat – schemat SQLite
-- Dane startowe (przepisy z PDF, katalog produktów, jadłospisy-szablony) ładuje db/seed.ts z data/seed/*.json.
-- Konwencje: gramy są źródłem prawdy; makro przepisu = na 1 porcję; makro produktu = na 100 g;
-- carbs_g = węglowodany ogółem (z błonnikiem), tak jak w jadłospisach PDF.

PRAGMA foreign_keys = ON;

CREATE TABLE app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ------------------------------------------------------------------ słowniki
CREATE TABLE meal_slots (
  id        TEXT PRIMARY KEY,                 -- breakfast | second_breakfast | lunch | dinner | snack
  name      TEXT NOT NULL,
  position  INTEGER NOT NULL,
  time_from TEXT,
  time_to   TEXT
);

CREATE TABLE slot_swap_compatibility (
  slot_id            TEXT NOT NULL REFERENCES meal_slots(id),
  compatible_slot_id TEXT NOT NULL REFERENCES meal_slots(id),
  position           INTEGER NOT NULL,
  PRIMARY KEY (slot_id, compatible_slot_id)
);

CREATE TABLE product_categories (
  id       TEXT PRIMARY KEY,
  name     TEXT NOT NULL,
  position INTEGER NOT NULL                   -- kolejność alejek w sklepie
);

CREATE TABLE units (
  id            TEXT PRIMARY KEY,             -- sztuka, łyżka, …
  short         TEXT NOT NULL,
  form_one      TEXT NOT NULL,                -- 1 sztuka
  form_few      TEXT NOT NULL,                -- 2–4 sztuki
  form_many     TEXT NOT NULL,                -- 5+ sztuk
  form_fraction TEXT NOT NULL                 -- 0,5 sztuki
);

CREATE TABLE allergens (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

-- ------------------------------------------------------------------ produkty
CREATE TABLE products (
  id                     TEXT PRIMARY KEY,
  name                   TEXT NOT NULL,
  category_id            TEXT NOT NULL REFERENCES product_categories(id),
  origin                 TEXT NOT NULL CHECK (origin IN ('plant','dairy','egg','honey','fish','meat')),
  pantry_staple          INTEGER NOT NULL DEFAULT 0 CHECK (pantry_staple IN (0,1)),
  shoppable              INTEGER NOT NULL DEFAULT 1 CHECK (shoppable IN (0,1)),
  kcal                   REAL,
  protein_g              REAL,
  fat_g                  REAL,
  carbs_g                REAL,
  fiber_g                REAL,
  nutrition_source       TEXT CHECK (nutrition_source IN ('reference','estimate','derived_from_recipes','calculated_from_base_recipe','label','user','ai_estimate')),
  nutrition_recipes_used INTEGER,
  base_recipe_id         TEXT REFERENCES recipes(id) DEFERRABLE INITIALLY DEFERRED,
  source_type            TEXT NOT NULL CHECK (source_type IN ('pdf_import','exchange_list','user','ai_generated')),
  created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX products_category ON products(category_id);

CREATE TABLE product_aliases (
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  alias      TEXT NOT NULL,
  PRIMARY KEY (product_id, alias)
);
CREATE INDEX product_aliases_alias ON product_aliases(alias COLLATE NOCASE);

CREATE TABLE product_allergens (
  product_id  TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  allergen_id TEXT NOT NULL REFERENCES allergens(id),
  PRIMARY KEY (product_id, allergen_id)
);

CREATE TABLE product_measures (
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  unit_id    TEXT NOT NULL REFERENCES units(id),
  grams      REAL NOT NULL CHECK (grams > 0),
  position   INTEGER NOT NULL,
  PRIMARY KEY (product_id, unit_id)
);

-- ------------------------------------------------------------------ przepisy
CREATE TABLE recipes (
  id                  TEXT PRIMARY KEY,
  kind                TEXT NOT NULL CHECK (kind IN ('meal','base')),
  name                TEXT NOT NULL,
  description         TEXT,
  servings            INTEGER NOT NULL CHECK (servings >= 1),
  kcal                REAL NOT NULL,          -- na porcję
  protein_g           REAL NOT NULL,
  carbs_g             REAL NOT NULL,
  fat_g               REAL NOT NULL,
  flavor              TEXT CHECK (flavor IN ('słodki','wytrawny')),
  prep_time_min       INTEGER,
  image               TEXT,
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','draft','archived')),
  version             INTEGER NOT NULL DEFAULT 1,
  variant_group       TEXT,
  yield_product_id    TEXT REFERENCES products(id),
  yield_amount_g      REAL,
  yield_pieces        INTEGER,
  yield_piece_unit    TEXT REFERENCES units(id),
  source_type         TEXT NOT NULL CHECK (source_type IN ('pdf_import','user','ai_generated','ai_modified')),
  source_model        TEXT,
  source_prompt       TEXT,
  source_generated_at TEXT,
  source_imported_at  TEXT,
  based_on_recipe_id  TEXT REFERENCES recipes(id),
  nutrition_origin    TEXT CHECK (nutrition_origin IN ('source_document','calculated','ai_estimate','user')),
  is_favorite         INTEGER NOT NULL DEFAULT 0 CHECK (is_favorite IN (0,1)),
  rating              INTEGER CHECK (rating BETWEEN 1 AND 5),
  notes               TEXT,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  CHECK (kind = 'meal' OR yield_product_id IS NOT NULL)
);
CREATE INDEX recipes_kind_status ON recipes(kind, status);
CREATE INDEX recipes_kcal ON recipes(kcal);

CREATE TABLE recipe_source_files (
  recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  file      TEXT NOT NULL,
  PRIMARY KEY (recipe_id, file)
);

CREATE TABLE recipe_slots (
  recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  slot_id   TEXT NOT NULL REFERENCES meal_slots(id),
  PRIMARY KEY (recipe_id, slot_id)
);
CREATE INDEX recipe_slots_slot ON recipe_slots(slot_id);

CREATE TABLE recipe_tags (
  recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  tag_type  TEXT NOT NULL CHECK (tag_type IN ('dish_type','protein','diet','features','custom')),
  tag       TEXT NOT NULL,
  PRIMARY KEY (recipe_id, tag_type, tag)
);
CREATE INDEX recipe_tags_tag ON recipe_tags(tag_type, tag);

CREATE TABLE recipe_allergens (
  recipe_id   TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  allergen_id TEXT NOT NULL REFERENCES allergens(id),
  PRIMARY KEY (recipe_id, allergen_id)
);

CREATE TABLE recipe_ingredients (
  id             INTEGER PRIMARY KEY,
  recipe_id      TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  position       INTEGER NOT NULL,
  product_id     TEXT NOT NULL REFERENCES products(id),
  name           TEXT NOT NULL,               -- nazwa wyświetlana w przepisie
  amount_g       REAL,                        -- na cały przepis; NULL = do smaku
  household_qty  REAL,
  household_unit TEXT REFERENCES units(id),
  group_name     TEXT,
  note           TEXT,
  optional       INTEGER NOT NULL DEFAULT 0 CHECK (optional IN (0,1)),
  UNIQUE (recipe_id, position)
);
CREATE INDEX recipe_ingredients_product ON recipe_ingredients(product_id);

CREATE TABLE recipe_steps (
  recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  position  INTEGER NOT NULL,
  text      TEXT NOT NULL,
  section   TEXT,
  timer_min REAL,
  PRIMARY KEY (recipe_id, position)
);

-- wyszukiwanie pełnotekstowe (nazwa + składniki); tekst jest „złożony” (małe litery, bez ogonków, ł→l)
CREATE VIRTUAL TABLE recipes_fts USING fts5(
  recipe_id UNINDEXED, name, ingredients,
  tokenize = 'unicode61 remove_diacritics 2'
);

-- ------------------------------------------------------------------ wymienniki
CREATE TABLE substitution_groups (
  id       TEXT PRIMARY KEY,
  name     TEXT NOT NULL,
  mode     TEXT NOT NULL CHECK (mode IN ('equal_weight','equivalent_portions')),
  note     TEXT,
  position INTEGER NOT NULL
);

CREATE TABLE substitution_items (
  group_id       TEXT NOT NULL REFERENCES substitution_groups(id) ON DELETE CASCADE,
  product_id     TEXT NOT NULL REFERENCES products(id),
  grams          REAL,                        -- tylko dla equivalent_portions
  household_qty  REAL,
  household_unit TEXT REFERENCES units(id),
  position       INTEGER NOT NULL,
  PRIMARY KEY (group_id, product_id)
);

-- ------------------------------------------------------------------ jadłospisy
CREATE TABLE plans (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  type         TEXT NOT NULL CHECK (type IN ('template','user')),
  start_date   TEXT,                          -- tylko plany użytkownika
  target_kcal  REAL,
  people       INTEGER NOT NULL DEFAULT 1 CHECK (people >= 1),
  source_file  TEXT,
  source_note  TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE plan_days (
  id           INTEGER PRIMARY KEY,
  plan_id      TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  day_number   INTEGER NOT NULL,
  date         TEXT,
  fiber_g      REAL,                          -- mikroskładniki z PDF (tylko szablony)
  calcium_mg   REAL,
  magnesium_mg REAL,
  UNIQUE (plan_id, day_number)
);

CREATE TABLE plan_meals (
  id                     INTEGER PRIMARY KEY,
  plan_day_id            INTEGER NOT NULL REFERENCES plan_days(id) ON DELETE CASCADE,
  position               INTEGER NOT NULL,
  slot_id                TEXT NOT NULL REFERENCES meal_slots(id),
  time_from              TEXT,
  time_to                TEXT,
  recipe_id              TEXT NOT NULL REFERENCES recipes(id),
  portions               REAL NOT NULL DEFAULT 1 CHECK (portions > 0),
  status                 TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','eaten','skipped')),
  leftover_of_meal_id    INTEGER REFERENCES plan_meals(id) ON DELETE SET NULL,  -- „z wczoraj” – nie kupujemy drugi raz
  swapped_from_recipe_id TEXT REFERENCES recipes(id)
);
CREATE INDEX plan_meals_day ON plan_meals(plan_day_id);
CREATE INDEX plan_meals_recipe ON plan_meals(recipe_id);

-- ------------------------------------------------------------------ listy zakupów
CREATE TABLE shopping_lists (
  id         TEXT PRIMARY KEY,
  plan_id    TEXT REFERENCES plans(id) ON DELETE SET NULL,
  name       TEXT NOT NULL,
  date_from  TEXT,
  date_to    TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE shopping_items (
  id             INTEGER PRIMARY KEY,
  list_id        TEXT NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
  product_id     TEXT REFERENCES products(id),
  custom_name    TEXT,                        -- pozycje dopisane ręcznie
  amount_g       REAL,
  household_hint TEXT,
  category_id    TEXT REFERENCES product_categories(id),
  checked        INTEGER NOT NULL DEFAULT 0 CHECK (checked IN (0,1)),
  manual         INTEGER NOT NULL DEFAULT 0 CHECK (manual IN (0,1)),
  CHECK (product_id IS NOT NULL OR custom_name IS NOT NULL)
);
CREATE INDEX shopping_items_list ON shopping_items(list_id);

-- ------------------------------------------------------------------ ustawienia użytkownika
CREATE TABLE user_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL                          -- JSON
);

-- ------------------------------------------------------------------ widoki
-- makro dnia jadłospisu
CREATE VIEW v_plan_day_totals AS
SELECT d.id AS plan_day_id, d.plan_id, d.day_number, d.date,
       ROUND(SUM(r.kcal      * m.portions))    AS kcal,
       ROUND(SUM(r.protein_g * m.portions), 1) AS protein_g,
       ROUND(SUM(r.carbs_g   * m.portions), 1) AS carbs_g,
       ROUND(SUM(r.fat_g     * m.portions), 1) AS fat_g,
       d.fiber_g, d.calcium_mg, d.magnesium_mg
FROM plan_days d
JOIN plan_meals m ON m.plan_day_id = d.id AND m.status <> 'skipped'
JOIN recipes r    ON r.id = m.recipe_id
GROUP BY d.id;

-- surowe zapotrzebowanie na produkty w jadłospisie (bez rozwijania półproduktów – robi to aplikacja)
-- posiłek „z resztek” nie generuje zakupów; posiłek gotowany kupuje także porcje zjedzone później jako resztki
CREATE VIEW v_plan_product_needs AS
SELECT d.plan_id, d.day_number, d.date, m.id AS plan_meal_id, ri.product_id,
       ri.amount_g * (m.portions + COALESCE((SELECT SUM(l.portions) FROM plan_meals l WHERE l.leftover_of_meal_id = m.id), 0))
                   / r.servings AS amount_g
FROM plan_meals m
JOIN plan_days d          ON d.id = m.plan_day_id
JOIN recipes r            ON r.id = m.recipe_id
JOIN recipe_ingredients ri ON ri.recipe_id = r.id
WHERE m.leftover_of_meal_id IS NULL AND m.status <> 'skipped' AND ri.amount_g IS NOT NULL;
