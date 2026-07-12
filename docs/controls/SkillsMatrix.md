# SkillsMatrix (`SkillsMatrix`)

A skills matrix, transposed: skills (grouped by category) as rows, people as
columns. Each cell holds a proficiency level 1–4, drawn as a quarter-filled
disc. Skills carry a target level; cells below target get a gap ring.

- **Schema id:** `ltk/skills@1`
- **Document:** yes · **Actions:** yes · **Snapshots:** `pngExport`, `svgExport`

See the [shared envelope](README.md#the-envelope-outputjson) and
[actions channel](README.md#the-actions-channel-actionsoutputjson).

## outputJSON — `data`

```json
{
  "categories": [
    {
      "id": "cat_1",
      "name": "Bottling line",
      "skills": [
        { "id": "sk_1", "name": "Filler changeover", "target": 3 }
      ]
    }
  ],
  "levels": {
    "sk_1": { "u-123": 2, "u-456": 4 }
  }
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `categories` | `SkillCategory[]` | Skill groups (rows), each with its skills. |
| `levels` | `Record<skillId, Record<personId, number>>` | Nested map: skill id → person `whoId` → level `1..4`. |

### SkillCategory / Skill

| Field | Type | Notes |
| --- | --- | --- |
| `category.id` | string | |
| `category.name` | string | Group heading. |
| `category.skills` | `Skill[]` | |
| `skill.id` | string | |
| `skill.name` | string | |
| `skill.target` | number | Target level `0..4`. |

**People are not in the document** — the columns come from the `peopleJSON`
input, keyed by `whoId` (which is what `levels` references). Level meanings:
1 Learning, 2 Assisted, 3 Independent, 4 Can teach.

## actionsOutputJSON

Emitted. Actions raised carry:

- `context.source` = `"skills"`
- `context.sourceId` = the **person's `whoId`** (the column the action was
  raised against)
