---
"@aliou/pi-processes": patch
---

Apply project settings only after Pi trusts the project. Untrusted repositories cannot override shell selection or background-command interception, and their config files are left unchanged. Show an ignored-config notice at session start and disable editing in the Local settings tab until trusted. Requires Pi >=1.4.0 and uses pi-utils-settings 0.24.0.
