---
trigger: always_on
---

# TypeScript Type Safety Rules (Required)

## Strictly Prohibited

- The `any` type (use `unknown` + type guards instead)
- Casts of any kind (`as` keyword) - use type / field checks instead
- Non-null assertions `\!`
- Use of `interface` for defining app specific types
- Ignore or bypass TypeScript and lint rules with comments such as `eslint-disable-next-line` or `@ts-ignore`
- Importing from nested directories like `import { logger } from "../utils/logger";`
- Default exports
- Functions declared with keyword `function`

## Required Patterns

- Create components with their respective style sheets inside a dedicated folder named after the component
- Create an `index.ts` file inside each component folder and barrel export the content of this folder
- Import everything from the "toppest" folder possible, since we're barrel exporting everything. Example `import { logger } from "../utils";
- Use `type` for defining app specific types
- Validate external API responses using `unknown` + Zod schemas
- Use generics wherever a function operates on multiple types
- Prefer type inference over redundant explicit annotations
- Resolve type errors by fixing the type definition or adding a type guard — never by widening to `any`
- Use arrow functions (const func = () => {}) instead of functions declared with keyword `function`

## Error Resolution Priority

When encountering a TypeScript error:

1. Fix the underlying type definition
2. Add a type guard function
3. Use a justified type assertion (with an inline comment explaining why)

## Code verification

- Always run TypeScript (`npx tsc --noEmit`) and lint checks (`npm run lint`) after you finish a feature. DO NOT EVER TELL THE USER YOU FINISHED A TASK BEFORE DOING THAT.
- Fix all TypeScript and lint issues that arise
