# Roadmap

## Da fare ora

1. **UI consapevole dei permessi (RBAC)** ✅
   - Se la lista dei namespace dà 403, il cluster si apre lo stesso: i namespace si inseriscono a mano e vengono ricordati per ogni contesto.
   - Se la lista su tutti i namespace è vietata, si ricade su una lista per ogni namespace consentito.
   - I permessi si chiedono al cluster con `SelfSubjectAccessReview`. Su GKE `SelfSubjectRulesReview` non vede i permessi IAM (risposta `incomplete`), quindi serve solo come indicazione: il 403 reale resta l'ultima parola.
   - Sezioni e azioni non permesse vengono nascoste o disattivate.
   - Caso da coprire: solo lettura dei log di alcuni pod, in alcuni namespace, senza lettura dei namespace.
2. **Watch al posto del polling** ✅
   - LIST iniziale + WATCH (watcher/reflector di kube-rs): il server spinge ADDED/MODIFIED/DELETED, che arrivano al frontend come eventi Tauri.
   - Se manca il verbo `watch` (403), si ricade sul polling.
   - Le metriche (metrics-server non supporta watch) restano in polling, con un intervallo più lungo.
3. **Server-side apply senza `force`** ✅
   - Apply normale; in caso di conflitto si mostrano i campi in conflitto e il loro manager, e si offre "Forza" come scelta esplicita.
4. **Events nel dettaglio di ogni risorsa** ✅ (field selector `involvedObject.uid`).
5. **Diagnosi pod** ✅
   - Riepilogo unico: eventi, `lastState`, probe, OOMKilled, image pull.
   - Debug con container effimero.
6. **Discovery automatica delle CRD/API** ✅ al posto della lista fissa in `catalog.ts`.
7. **Test e CI**
   - Test Rust (parsing, classificazione errori, quantità) e frontend (Vitest).
   - GitHub Actions: typecheck, test, build per Linux / Windows / macOS.
8. **README e pacchetti**: istruzioni per Linux (`.deb`, `.rpm`, `.AppImage`) e macOS.

## Dopo

- Confronto di una risorsa tra due cluster (es. for-care-test ↔ forcareprod-mesh).
- Ricerca rapida / command palette (Ctrl+K) e scorciatoie da tastiera.
- Integrazione API GCP: node pool, versione/canale, manutenzione, Cloud Logging, Recommender.
- Release Helm in sola lettura (secret `helm.sh/release.v1`). Priorità bassa: Helm è poco usato e servono permessi di lettura sui secret.

## Note macOS

- I binari si compilano solo su un Mac o su un runner `macos` di GitHub Actions (universal: arm64 + x86_64).
- Un'app avviata dal Finder non eredita il `PATH` della shell, quindi `kubectl`, `gcloud` e `gke-gcloud-auth-plugin` installati con Homebrew non si trovano. Serve ricostruire il PATH all'avvio.
- Senza firma, Gatekeeper blocca il primo avvio: si apre con "clic destro → Apri" oppure con `xattr -cr`. Firma e notarizzazione richiedono l'Apple Developer Program (99 $/anno).
