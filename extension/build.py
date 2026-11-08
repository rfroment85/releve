# Assemble le script de contenu (moteur + orchestration) dans une portée isolée, pour pouvoir le réinjecter sans conflit.
import pathlib, re
root = pathlib.Path(__file__).parent
pdf = (root/'lib/pdftext.js').read_text()
tf = (root/'lib/avistf.js').read_text()
core = (root/'lib/core.js').read_text()
content = (root/'content.js').read_text()
strip = lambda s: re.sub(r"^'use strict';\s*$", '', s, flags=re.M)
out = "// Fichier généré par build.py à partir de lib/pdftext.js, lib/avistf.js, lib/core.js et content.js : ne pas modifier.\n(() => {\n'use strict';\n" + strip(pdf) + "\n" + strip(tf) + "\n" + strip(core) + "\n" + strip(content) + "\n})();\n"
(root/'content.bundle.js').write_text(out)
print('content.bundle.js', len(out))
