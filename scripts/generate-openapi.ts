import { writeFile } from "node:fs/promises"
import { generateSpecs } from "hono-openapi"
import { app } from "../src"
import { OpenApiRouter } from "../src/routes/OpenApiRouter"

async function main() {
  const spec = await generateSpecs(app, OpenApiRouter.OpenApiDocumentation)

  await writeFile("openapi.json", JSON.stringify(spec, null, 2) + "\n")
  console.log("openapi.json generated")
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})