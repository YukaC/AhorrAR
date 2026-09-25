# ADR-0003 — Índice de tiendas AR compartido Node↔Python (auto-expansible)

- **Estado**: aceptada
- **Fecha**: 2026-09-23
- **Decisores / participantes**: usuario + IA
- **Relacionado**: `SPEC.md` §V19 · §C.?? · §T22 · `shared/ar-shops.json`

## Contexto
El crawler tiene dos implementaciones (Scrapling Python primario + BFS Node legacy) y
dos lenguajes. Cada una armaba sus seeds a mano, con categorías y heurísticas
divergentes → riesgo de reputación y cobertura distintas según el motor. Además, las
tiendas descubiertas en runtime no se recordaban entre ejecuciones.

## Decisión
Un **mismo índice JSON** (`shared/ar-shops.json`) como fuente única de tiendas AR,
leído por Node (`seeds.ts`) y igual por Python (`seeds.py`). Entradas `{host, category,
curated, entry}` donde `entry` es un template de búsqueda canónico (p. ej. VTEX API con
`{q}`) o `null`. Los hosts nuevos con ofertas se **persisten en el índice** de forma
atómica (tmp+rename) desde cualquiera de los motores (V19: mismo tier de reputación en
ambos lados).

## Consecuencias
Positivas:
- Reputación coherente Node↔Python; cambiar categorías es tocar un solo doc.
- Auto-expansión: cada tienda descubierta mejora la próxima búsqueda (curada? → curated:false).
- `guessSearchUrls` ampliado (7 plantillas: VTEX, Vtex-`_q`, busca, buscar, Magento, Woo, genérico).

Negativas / costos:
- Escritura concurrente Node+Python → tmp+rename atómico; fallos no-fatales (advisory).
- Sincronía entre motores: si se agrega una categoría hay que tocar `CategoryId` en ambos.

## Alternativas consideradas
| Alternativa | Por qué se descartó |
|---|---|
| Índice solo en Python (fuente única) | Node legacy y front compartirían contrato distinto por lenguaje |
| Duplicar lista en Node y Python | Violación del criterio "misma fuente"; drift garantizado |
| DB externa (SQLite/Redis) para el índice | Sobra infra para 14 tiendas; file JSON alcanza y es versionable |