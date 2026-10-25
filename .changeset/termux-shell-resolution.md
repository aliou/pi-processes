---
"@aliou/pi-processes": patch
---

Resolve the shell from the Termux `$PREFIX` (`$PREFIX/bin/bash`) and `$SHELL` on systems without `/bin/bash`, such as Android/Termux where Nix and standard Unix paths don't exist.
