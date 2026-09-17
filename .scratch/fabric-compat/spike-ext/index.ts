/**
 * fabric-compat spike — throwaway extension registering a dummy tool with a
 * top-level anyOf (discriminated union) schema. Spike leg (a) live evidence.
 */
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";

const union = Type.Union([
	Type.Object({ op: Type.Literal("greet", { description: "spike op" }), name: Type.Optional(Type.String()) }),
	Type.Object({ op: Type.Literal("add"), a: Type.Number(), b: Type.Number() }),
	Type.Object({ op: Type.Literal("echo"), text: Type.String() }),
], { description: "spike operation" });

export default function spikeUnionTool(pi) {
	pi.registerTool({
		name: "spike_union",
		label: "Spike Union",
		description: "anyOf-schema spike tool (fabric-compat union spike).",
		parameters: union,
		async execute(_id, params) {
			return { content: [{ type: "text", text: JSON.stringify(params) }], details: { echo: params } };
		},
	});
	return true;
}
