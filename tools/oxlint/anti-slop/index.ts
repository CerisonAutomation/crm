import { definePlugin } from "@oxlint/plugins";

import { noChainedTypeAssertionsRule } from "./rules/no-chained-type-assertions";
import { noConditionalEmptyObjectSpreadRule } from "./rules/no-conditional-empty-object-spread";
import { noKnownValueWideningRule } from "./rules/no-known-value-widening";
import { noObjectParametersRule } from "./rules/no-object-parameters";
import { noRuntimeTypeofRule } from "./rules/no-runtime-typeof";
import { noForbiddenTermInSymbolNamesRule } from "./rules/no-shape-in-symbol-names";
import { noUnknownParametersRule } from "./rules/no-unknown-parameters";
import { noUnknownTypeAliasesRule } from "./rules/no-unknown-type-aliases";
import { noUnsafeDictionaryTypeRule } from "./rules/no-unsafe-dictionary-type";
import { noWidenThenAssertRule } from "./rules/no-widen-then-assert";

/** Generic Oxlint rules that reject low-evidence and low-signal implementation patterns. */
const antiSlopPlugin = definePlugin({
	meta: { name: "anti-slop" },
	rules: {
		"no-chained-type-assertions": noChainedTypeAssertionsRule,
		"no-conditional-empty-object-spread": noConditionalEmptyObjectSpreadRule,
		"no-known-value-widening": noKnownValueWideningRule,
		"no-object-parameters": noObjectParametersRule,
		"no-runtime-typeof": noRuntimeTypeofRule,
		"no-unsafe-dictionary-type": noUnsafeDictionaryTypeRule,
		"no-shape-in-symbol-names": noForbiddenTermInSymbolNamesRule,
		"no-unknown-parameters": noUnknownParametersRule,
		"no-unknown-type-aliases": noUnknownTypeAliasesRule,
		"no-widen-then-assert": noWidenThenAssertRule,
	},
});

export default antiSlopPlugin;
