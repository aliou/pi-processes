---
"@aliou/pi-processes": minor
---

Replace TypeBox with @earendil-works/pi-schema for all tool and output schemas. Tool parameter schemas are now closed objects (`additionalProperties: false`), so unknown fields sent by the model are rejected by validation instead of ignored. Target Pi 1.6.1.
