# RiskMatrix (`RiskMatrix`)

A 5×5 risk register. Each risk is framed as hazard / risk / impact / controls,
rated likelihood × consequence, with the cell resolving to a risk class I–IV via
a fixed lookup (not a raw score band). An optional post-control (residual) rating
shows the movement. Treatments are canonical actions.

- **Schema id:** `ltk/riskmatrix@1`
- **Document:** yes · **Actions:** yes · **Snapshots:** `pngExport`, `svgExport`

See the [shared envelope](README.md#the-envelope-outputjson) and
[actions channel](README.md#the-actions-channel-actionsoutputjson).

## outputJSON — `data`

```json
{
  "risks": [
    {
      "id": "r_1",
      "hazard": "Hot CIP caustic",
      "risk": "Operator burn during line break-in",
      "impact": "Lost-time injury",
      "controls": "Lockout, PPE, dual-verify",
      "likelihood": 3,
      "consequence": 4,
      "postLikelihood": 2,
      "postConsequence": 3
    }
  ]
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `risks` | `Risk[]` | The register. |

### Risk

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | |
| `hazard` | string | The hazard / source. |
| `risk` | string | The risk statement (a legacy `text` field is migrated into `risk` on parse). |
| `impact` | string | The consequence description. |
| `controls` | string | Existing controls / treatment summary. |
| `likelihood` | number | `1..5` (inherent). |
| `consequence` | number | `1..5` (inherent). |
| `postLikelihood` | number \| null | Residual likelihood after controls; `null` = not rated. |
| `postConsequence` | number \| null | Residual consequence after controls; `null` = not rated. |

The class I–IV is derived from likelihood × consequence via a fixed lookup — it
is not stored.

## actionsOutputJSON

Emitted. Treatment actions raised on a risk carry:

- `context.source` = `"riskmatrix"`
- `context.sourceId` = the **risk id**
