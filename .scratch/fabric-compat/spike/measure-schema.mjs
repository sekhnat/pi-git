const { githubSchema } = await import("/home/caan9/openspec/pi-extensions/pi-git/extensions/lib/gh/schema.ts");
const j = JSON.stringify(githubSchema);
console.log("schema_json_chars:", j.length, "| under_4096:", j.length <= 4096, "| variants:", githubSchema.anyOf.length);
