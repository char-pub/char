# `@commons` 种子内容审阅表

这些 Creation 是 AI 辅助起草的原创内容，许可 CC0-1.0，评级 general，**尚未发布**。每一项都需要人工审阅：确认原创性、适龄与措辞后勾选。全部审阅通过后才会发布到 `@commons`。

表中的 semantic digest 由 `pnpm commons:check` 算出。修改内容后 digest 会变化，请重新运行并更新本表（`pnpm commons:check --json` 输出完整结果）。

## 总表

| ref | 类型 | 条目 | 依赖 | semantic digest |
|---|---|---|---|---|
| `@commons/amber-road` | world | 6 个 fragment | — | `sha256:fc723bab80262329240894f51df895926d7dd33f0227000ed19b2154750dd98b` |
| `@commons/brassford` | world | 6 个 fragment | — | `sha256:f03086ee5e559998807966a4a9f0ab0730053b7ad7f21488955825518c448221` |
| `@commons/fathom-station` | world | 6 个 fragment | — | `sha256:c0d11908c3b176898309aa4d60018321776fc6e61d6e3fde843de57cccbdf567` |
| `@commons/frostmarch` | world | 6 个 fragment | — | `sha256:e2cde72bc95fef33dd016f97912f532122e6d3e58cd2c9dcedfc63bb6f4fe54c` |
| `@commons/greenhollow` | world | 6 个 fragment | — | `sha256:2fb0f18fdeb3781beb0668fa6e2338767fee719102c7640b4270dd4cf72f1103` |
| `@commons/halcyon-ring` | world | 6 个 fragment | — | `sha256:bdcf6206cf3107cca8b060569a6f269de9d87cf1596328c4e43736781330e71f` |
| `@commons/lumen-academy` | world | 6 个 fragment | — | `sha256:9fa92c2a9cc0b046facb785db7e0680ce885869800d7d7bfa4c14e6248fee0ea` |
| `@commons/mistpeak` | world | 6 个 fragment | — | `sha256:8d5bfb71e78a4b915c848d395993c0006c192c4c4c0dbbfe8eed11e4d061f15d` |
| `@commons/neon-undercity` | world | 6 个 fragment | — | `sha256:b3cefabebe771a2e3e5711bd734f629406cd95dc620859f034a9b6e4c72a4d6a` |
| `@commons/saltmere` | world | 6 个 fragment | — | `sha256:a79d011b1fcb5dd7a17dfe17014eb6a93d47a6c1e0d23a21eed28a1952a01845` |
| `@commons/sunward-isles` | world | 6 个 fragment | — | `sha256:72c2042872a7396de00d57648c8b3b19028f0c8e744ed292079937d77efabc15` |
| `@commons/willow-creek` | world | 6 个 fragment | — | `sha256:9d1aa24e8c783dbbf361dd1ae6d8388c1f11a1727d90e1b7a3f5b838b5c5012d` |
| `@commons/amber-road-guide` | lorebook | 12 条关键词条目 | — | `sha256:36e04eb160e339069cced38bfbb8b270b92e86ebaf907b944f497cc6bb1615bf` |
| `@commons/brassford-engines` | lorebook | 12 条关键词条目 | — | `sha256:f1e5249605afaeba2ec1838f71bf9b205b936d3cf6c8fc1710801b024797d29b` |
| `@commons/fathom-field-notes` | lorebook | 12 条关键词条目 | — | `sha256:512a12418785cccbd320d385116f557be355481e5d0ed7dcf2c91f67797092c1` |
| `@commons/frostmarch-clans` | lorebook | 12 条关键词条目 | — | `sha256:acecfbc9074977db62536f2323d614e8a402d22ee45182a61c6fe74e9c64baa5` |
| `@commons/halcyon-systems` | lorebook | 12 条关键词条目 | — | `sha256:72575c4011a42b9ae76319f4dc616d482d52a05be55df12c56dd0988af02e418` |
| `@commons/mistpeak-customs` | lorebook | 12 条关键词条目 | — | `sha256:d479f5ce50ed4a55df9f8c6128f4cb8669c6ed33f2c8b4dd07ef7d9528701878` |
| `@commons/saltmere-guilds` | lorebook | 12 条关键词条目 | — | `sha256:a0176ae2e7ff9a63588e155095f101fd50a4fb201cff662967266d8dabf0b99b` |
| `@commons/sunward-legends` | lorebook | 11 条关键词条目 | — | `sha256:a48f1127138383e5e6fb1a8ed72728a1e40008194a30e96bc18b0fed6a11479c` |
| `@commons/taverns-and-markets` | lorebook | 11 条关键词条目 | — | `sha256:86b1a8e47ddcd5d5adf13dd4e403306f2c3245c410fecd5943c541b6946a6fcf` |
| `@commons/undercity-street-guide` | lorebook | 12 条关键词条目 | — | `sha256:11f400186f127487b3ffe78dda886f3bb75fb42cbd6a2ca8179538e3c8480118` |
| `@commons/weather-and-seasons` | lorebook | 11 条关键词条目 | — | `sha256:0c61d57c13e0232c1bf0f88aecbbe07cd8a2da76bf5f33668353d2e09302b33c` |
| `@commons/willow-creek-townsfolk` | lorebook | 12 条关键词条目 | — | `sha256:17f1095b399945d26539115f2fd3b8f558c75efbb8829e1484de634e45ef1881` |
| `@commons/wren-the-harbor-guide` | character | 5 个 fragment | `@commons/saltmere`、`@commons/saltmere-guilds`、`@commons/weather-and-seasons` | `sha256:b292424b1cd973e62ce98990198766e4f8d2d0858f44bafc8db47129ced50117` |

## 每一项的审阅要点

每一项都要确认三件事：

- **原创性**：不模仿、不引用任何已有作品、真实人物、商标或真实商户的名字。
- **适龄**：全年龄（general），没有露骨、血腥或令人不适的描写。
- **措辞**：英文通顺，不含偏见或刻板印象；中文 `display_name` / `summary` 翻译准确。

### `@commons/amber-road`（world）

A desert trade route of caravans, oasis towns and well-keepers who guard the only reliable water for a hundred leagues.

- 文件：`content/commons/amber-road/char.yaml`
- 条目：6 个 fragment
- semantic digest：`sha256:fc723bab80262329240894f51df895926d7dd33f0227000ed19b2154750dd98b`
- 重点：Desert trade route: review for respectful portrayal of desert and nomadic cultures, and that no real people or places are implied.

- [ ] 原创性已确认
- [ ] 适龄已确认
- [ ] 措辞已确认
- 审阅人 / 日期：

### `@commons/brassford`（world）

A steam-powered river port where paddle wheels, clock towers and canal locks run on coal, craft and stubbornness.

- 文件：`content/commons/brassford/char.yaml`
- 条目：6 个 fragment
- semantic digest：`sha256:f03086ee5e559998807966a4a9f0ab0730053b7ad7f21488955825518c448221`
- 重点：Steam-era industrial city; confirm the tone stays general-audience around boiler explosions and strikes.

- [ ] 原创性已确认
- [ ] 适龄已确认
- [ ] 措辞已确认
- 审阅人 / 日期：

### `@commons/fathom-station`（world）

A deep-sea research base on the edge of an ocean trench, where a small crew studies life that has never seen the sun.

- 文件：`content/commons/fathom-station/char.yaml`
- 条目：6 个 fragment
- semantic digest：`sha256:c0d11908c3b176898309aa4d60018321776fc6e61d6e3fde843de57cccbdf567`
- 重点：Deep-sea research base; mentions isolation stress ("going quiet"). Confirm the wording suits general audiences.

- [ ] 原创性已确认
- [ ] 适龄已确认
- [ ] 措辞已确认
- 审阅人 / 日期：

### `@commons/frostmarch`（world）

A northern ice plain of reindeer-herding clans, long nights, aurora-lit festivals and hard-won hospitality.

- 文件：`content/commons/frostmarch/char.yaml`
- 条目：6 个 fragment
- semantic digest：`sha256:e2cde72bc95fef33dd016f97912f532122e6d3e58cd2c9dcedfc63bb6f4fe54c`
- 重点：Northern herding clans: review for respectful portrayal, and that it does not appropriate the names, clothing or beliefs of any specific real Indigenous people.

- [ ] 原创性已确认
- [ ] 适龄已确认
- [ ] 措辞已确认
- 审阅人 / 日期：

### `@commons/greenhollow`（world）

A hopeful post-collapse farming commune that rebuilds with salvage, seed banks and shared work, generations after the old world fell.

- 文件：`content/commons/greenhollow/char.yaml`
- 条目：6 个 fragment
- semantic digest：`sha256:2fb0f18fdeb3781beb0668fa6e2338767fee719102c7640b4270dd4cf72f1103`
- 重点：Hopeful post-collapse commune; the collapse is background history only. Confirm nothing is graphic.

- [ ] 原创性已确认
- [ ] 适龄已确认
- [ ] 措辞已确认
- 审阅人 / 日期：

### `@commons/halcyon-ring`（world）

A near-future orbital station where a few thousand people share air, water and a long waiting list for window seats.

- 文件：`content/commons/halcyon-ring/char.yaml`
- 条目：6 个 fragment
- semantic digest：`sha256:bdcf6206cf3107cca8b060569a6f269de9d87cf1596328c4e43736781330e71f`
- 重点：Generic rotating-station tropes; check that nothing reads as a specific film, game or novel station.

- [ ] 原创性已确认
- [ ] 适龄已确认
- [ ] 措辞已确认
- 审阅人 / 日期：

### `@commons/lumen-academy`（world）

A city that is also a university, where colleges compete in debates, libraries never close and every student belongs to a house.

- 文件：`content/commons/lumen-academy/char.yaml`
- 条目：6 个 fragment
- semantic digest：`sha256:9fa92c2a9cc0b046facb785db7e0680ce885869800d7d7bfa4c14e6248fee0ea`
- 重点：University city; college and house names are invented. Check they do not match real universities.

- [ ] 原创性已确认
- [ ] 适龄已确认
- [ ] 措辞已确认
- 审阅人 / 日期：

### `@commons/mistpeak`（world）

A mountain town of terraced tea fields, cliffside temples and stone stairways, inspired by East Asian hill towns.

- 文件：`content/commons/mistpeak/char.yaml`
- 条目：6 个 fragment
- semantic digest：`sha256:8d5bfb71e78a4b915c848d395993c0006c192c4c4c0dbbfe8eed11e4d061f15d`
- 重点：East-Asian-inspired setting: review for respectful, non-stereotyped portrayal, and that it borrows no real named place or religion.

- [ ] 原创性已确认
- [ ] 适龄已确认
- [ ] 措辞已确认
- 审阅人 / 日期：

### `@commons/neon-undercity`（world）

The crowded lower levels of a vertical megacity, where repair shops, noodle stalls and neighborhood networks keep life running under the elevated towers.

- 文件：`content/commons/neon-undercity/char.yaml`
- 条目：6 个 fragment
- semantic digest：`sha256:b3cefabebe771a2e3e5711bd734f629406cd95dc620859f034a9b6e4c72a4d6a`
- 重点：Cyberpunk-inspired; confirm it avoids trademarked terms and franchise names. Mentions a rumor about a missing neighbor; check the tone.

- [ ] 原创性已确认
- [ ] 适龄已确认
- [ ] 措辞已确认
- 审阅人 / 日期：

### `@commons/saltmere`（world）

A low-magic harbor city-state run by rival guilds, where the tide decides the calendar.

- 文件：`content/commons/saltmere/char.yaml`
- 条目：6 个 fragment
- semantic digest：`sha256:a79d011b1fcb5dd7a17dfe17014eb6a93d47a6c1e0d23a21eed28a1952a01845`
- 重点：Guild names and the tide-based calendar are invented; confirm the harbor-guild concept does not closely track a specific published setting.

- [ ] 原创性已确认
- [ ] 适龄已确认
- [ ] 措辞已确认
- 审阅人 / 日期：

### `@commons/sunward-isles`（world）

A mythic archipelago where sailors navigate by stars and songs, and every island keeps a story about how it was raised from the sea.

- 文件：`content/commons/sunward-isles/char.yaml`
- 条目：6 个 fragment
- semantic digest：`sha256:72c2042872a7396de00d57648c8b3b19028f0c8e744ed292079937d77efabc15`
- 重点：Voyaging islands with invented myths: review for respectful portrayal, and that the Sea Mother and Star Weavers do not copy any real tradition's deities or names.

- [ ] 原创性已确认
- [ ] 适龄已确认
- [ ] 措辞已确认
- 审阅人 / 日期：

### `@commons/willow-creek`（world）

A quiet present-day small town with a main street, a lake, a volunteer fire station and neighbors who know everyone's business.

- 文件：`content/commons/willow-creek/char.yaml`
- 条目：6 个 fragment
- semantic digest：`sha256:9d1aa24e8c783dbbf361dd1ae6d8388c1f11a1727d90e1b7a3f5b838b5c5012d`
- 重点：Present-day small town; check that shop and person names do not match real businesses.

- [ ] 原创性已确认
- [ ] 适龄已确认
- [ ] 措辞已确认
- 审阅人 / 日期：

### `@commons/amber-road-guide`（lorebook）

Oasis towns, the Well-Keepers, caravan customs, desert hazards and trade goods along the Amber Road.

- 文件：`content/commons/amber-road-guide/char.yaml`
- 条目：12 条关键词条目
- semantic digest：`sha256:36e04eb160e339069cced38bfbb8b270b92e86ebaf907b944f497cc6bb1615bf`
- 重点：Companion to the Amber Road; review the hospitality and mint-tea customs for respectful portrayal.

- [ ] 原创性已确认
- [ ] 适龄已确认
- [ ] 措辞已确认
- 审阅人 / 日期：

### `@commons/brassford-engines`（lorebook）

Steam engines, canal locks, guild examinations, newspapers and the rival companies of Brassford.

- 文件：`content/commons/brassford-engines/char.yaml`
- 条目：12 条关键词条目
- semantic digest：`sha256:f1e5249605afaeba2ec1838f71bf9b205b936d3cf6c8fc1710801b024797d29b`
- 重点：Companion to Brassford; company and newspaper names are invented. Check they do not match real ones.

- [ ] 原创性已确认
- [ ] 适龄已确认
- [ ] 措辞已确认
- 审阅人 / 日期：

### `@commons/fathom-field-notes`（lorebook）

Deep-sea creatures, station equipment, safety drills and crew routines recorded aboard Fathom Station.

- 文件：`content/commons/fathom-field-notes/char.yaml`
- 条目：12 条关键词条目
- semantic digest：`sha256:512a12418785cccbd320d385116f557be355481e5d0ed7dcf2c91f67797092c1`
- 重点：Companion to Fathom Station; creature names are invented. Confirm the unexplained "low sound" hook stays mild.

- [ ] 原创性已确认
- [ ] 适龄已确认
- [ ] 措辞已确认
- 审阅人 / 日期：

### `@commons/frostmarch-clans`（lorebook）

The five clans of the Frostmarch, their herds, seasons, festivals, laws of hospitality and survival lore.

- 文件：`content/commons/frostmarch-clans/char.yaml`
- 条目：12 条关键词条目
- semantic digest：`sha256:acecfbc9074977db62536f2323d614e8a402d22ee45182a61c6fe74e9c64baa5`
- 重点：Companion to the Frostmarch; review clan and custom descriptions for respectful portrayal of herding cultures.

- [ ] 原创性已确认
- [ ] 适龄已确认
- [ ] 措辞已确认
- 审阅人 / 日期：

### `@commons/halcyon-systems`（lorebook）

How life support, allowances, sectors, shuttles and station customs work aboard Halcyon Ring.

- 文件：`content/commons/halcyon-systems/char.yaml`
- 条目：12 条关键词条目
- semantic digest：`sha256:72575c4011a42b9ae76319f4dc616d482d52a05be55df12c56dd0988af02e418`
- 重点：Companion to Halcyon Ring; technical details are plausible, not accurate engineering.

- [ ] 原创性已确认
- [ ] 适龄已确认
- [ ] 措辞已确认
- 审阅人 / 日期：

### `@commons/mistpeak-customs`（lorebook）

Tea harvests, temple records, porters, shrine bells and the festivals and manners of Mistpeak.

- 文件：`content/commons/mistpeak-customs/char.yaml`
- 条目：12 条关键词条目
- semantic digest：`sha256:d479f5ce50ed4a55df9f8c6128f4cb8669c6ed33f2c8b4dd07ef7d9528701878`
- 重点：Companion to Mistpeak; review the tea, greeting and shrine customs for respectful, non-stereotyped portrayal.

- [ ] 原创性已确认
- [ ] 适龄已确认
- [ ] 措辞已确认
- 审阅人 / 日期：

### `@commons/saltmere-guilds`（lorebook）

The seven chartered guilds of Saltmere, the Tide Watch, the tidewrights and the institutions that keep the harbor city running.

- 文件：`content/commons/saltmere-guilds/char.yaml`
- 条目：12 条关键词条目
- semantic digest：`sha256:a0176ae2e7ff9a63588e155095f101fd50a4fb201cff662967266d8dabf0b99b`
- 重点：Companion to Saltmere; mentions exile as a punishment and unlicensed weather-workers. Confirm the tone.

- [ ] 原创性已确认
- [ ] 适龄已确认
- [ ] 措辞已确认
- 审阅人 / 日期：

### `@commons/sunward-legends`（lorebook）

Myths, voyaging lore, island customs and the stories the Sunward islanders tell about their home.

- 文件：`content/commons/sunward-legends/char.yaml`
- 条目：11 条关键词条目
- semantic digest：`sha256:a48f1127138383e5e6fb1a8ed72728a1e40008194a30e96bc18b0fed6a11479c`
- 重点：Companion to the Sunward Isles; review the myths and customs for respectful portrayal of island voyaging cultures.

- [ ] 原创性已确认
- [ ] 适龄已确认
- [ ] 措辞已确认
- 审阅人 / 日期：

### `@commons/taverns-and-markets`（lorebook）

A setting-neutral lorebook of common tavern, inn and market customs that any fantasy or historical world can reuse.

- 文件：`content/commons/taverns-and-markets/char.yaml`
- 条目：11 条关键词条目
- semantic digest：`sha256:86b1a8e47ddcd5d5adf13dd4e403306f2c3245c410fecd5943c541b6946a6fcf`
- 重点：Setting-neutral; check that it reads as generic and reusable.

- [ ] 原创性已确认
- [ ] 适龄已确认
- [ ] 措辞已确认
- 审阅人 / 日期：

### `@commons/undercity-street-guide`（lorebook）

Markets, lanterns, repair culture, slang and places of the Neon Undercity of Veradis.

- 文件：`content/commons/undercity-street-guide/char.yaml`
- 条目：12 条关键词条目
- semantic digest：`sha256:11f400186f127487b3ffe78dda886f3bb75fb42cbd6a2ca8179538e3c8480118`
- 重点：Companion to the Undercity; slang terms are invented. Check none is a real slur or trademark.

- [ ] 原创性已确认
- [ ] 适龄已确认
- [ ] 措辞已确认
- 审阅人 / 日期：

### `@commons/weather-and-seasons`（lorebook）

A setting-neutral lorebook describing weather, seasons and how they change travel, work and mood, for any world with ordinary climate.

- 文件：`content/commons/weather-and-seasons/char.yaml`
- 条目：11 条关键词条目
- semantic digest：`sha256:0c61d57c13e0232c1bf0f88aecbbe07cd8a2da76bf5f33668353d2e09302b33c`
- 重点：Setting-neutral; check that it reads as generic and reusable.

- [ ] 原创性已确认
- [ ] 适龄已确认
- [ ] 措辞已确认
- 审阅人 / 日期：

### `@commons/willow-creek-townsfolk`（lorebook）

The shops, landmarks, local institutions and yearly traditions of the small town of Willow Creek.

- 文件：`content/commons/willow-creek-townsfolk/char.yaml`
- 条目：12 条关键词条目
- semantic digest：`sha256:17f1095b399945d26539115f2fd3b8f558c75efbb8829e1484de634e45ef1881`
- 重点：Companion to Willow Creek; check that the business names (Creekside Diner, Bell's Hardware, Page and Paw, The Grind, Hartley Orchard) do not match well-known real businesses.

- [ ] 原创性已确认
- [ ] 适龄已确认
- [ ] 措辞已确认
- 审阅人 / 日期：

### `@commons/wren-the-harbor-guide`（character）

A cheerful message runner and self-appointed guide to Saltmere harbor, who knows every guild's gossip and every tide by heart.

- 文件：`content/commons/examples/wren-the-harbor-guide/char.yaml`
- 条目：5 个 fragment
- semantic digest：`sha256:b292424b1cd973e62ce98990198766e4f8d2d0858f44bafc8db47129ced50117`
- 重点：Example character that references Saltmere, Saltmere Guilds and four weather entries of Weather and Seasons. Wren is an adult (about nineteen); confirm the characterization and the greeting.

- [ ] 原创性已确认
- [ ] 适龄已确认
- [ ] 措辞已确认
- 审阅人 / 日期：
