# EscalationViewer (`EscalationViewer`)

A read / acknowledge view over the actions channel — no document. The app feeds
it escalated actions (`Filter(Actions, Escalated = true)`) via
`actionsInputJSON`; the viewer groups them by their source card and lets the
receiving board acknowledge, comment, restatus or reassign. Edits are written
back on `actionsOutputJSON`.

- **Schema id:** none (no document) · **Actions:** yes ·
  **Snapshots:** `pngExport`, `svgExport`

See the [actions channel](README.md#the-actions-channel-actionsoutputjson) for
the `LtkAction` shape.

## outputJSON

**Not emitted.** No document — the actions channel is the data.

## actionsOutputJSON

Emitted. It returns the full canonical `LtkAction[]` with the viewer's edits
(acknowledgements, comments, status/reassignment). Two things are specific to
this control:

- **Acknowledgement.** Acknowledging an escalation sets the action's
  `acknowledged` to `{ whoId, who, when }`, stamped from the `viewerId` /
  `viewerName` inputs with an ISO `when`. Un-acknowledging removes the key.
- **Instance ids are preserved.** Unlike other controls, EscalationViewer does
  **not** re-stamp `instanceId` on output — each action keeps its *source*
  card's `instanceId`, so the app upserts it back against the right card by
  action `id`.

There is no separate "selected action" output — every edit folds back into the
whole `actionsOutputJSON` set.
