import type { Linter } from "eslint";

import {
  AST_NODE_TYPES,
  ESLintUtils,
  type TSESLint,
  type TSESTree,
} from "@typescript-eslint/utils";
import ts from "typescript";

const createRule = ESLintUtils.RuleCreator(() => "");

const FRONTEND_FILES = ["src/**/*.{ts,tsx}", "components/**/*.{ts,tsx}"];
const FRONTEND_IGNORES = ["src/tests/**", "**/*.test.*", "convex/**"];
const NEVERTHROW_MODULE_NAME = "neverthrow";
const NON_FRONTEND_IGNORES = [...FRONTEND_FILES, "convex/_generated/**"];
const HANDLED_METHODS = new Set(["_unsafeUnwrap", "match", "unwrapOr"]);
const IGNORED_PARENT_TYPES = new Set([
  AST_NODE_TYPES.ClassDeclaration,
  AST_NODE_TYPES.FunctionDeclaration,
  AST_NODE_TYPES.MethodDefinition,
  AST_NODE_TYPES.PropertyDefinition,
  AST_NODE_TYPES.TSAbstractPropertyDefinition,
]);
const RESULT_PROPERTIES = [
  "andThen",
  "map",
  "mapErr",
  "match",
  "orElse",
  "unwrapOr",
] as const;
const RESULT_SELECTOR = ":matches(CallExpression, NewExpression)";

type FlatConfigPlugin = NonNullable<
  NonNullable<Linter.Config["plugins"]>[string]
>;
type MustUseResultMessageIds = "mustUseResult";
interface NeverthrowConfigOptions {
  parser: unknown;
  project?: string;
  tsconfigRootDir: string;
}
type NeverthrowImportMessageIds = "noNeverthrowOutsideFrontend";
type NoThrowMessageIds = "noThrowInFrontend";
type RuleOptions = [];
type TypedParserServices = ReturnType<typeof ESLintUtils.getParserServices>;

type TypedRuleContext<MessageIds extends string> = Readonly<
  TSESLint.RuleContext<MessageIds, RuleOptions>
>;

export function createNeverthrowConfigs(options: NeverthrowConfigOptions) {
  return [
    {
      files: FRONTEND_FILES,
      ignores: FRONTEND_IGNORES,
      languageOptions: {
        parser: options.parser,
        parserOptions: {
          ecmaFeatures: {
            jsx: true,
          },
          project: options.project ?? "./tsconfig.json",
          tsconfigRootDir: options.tsconfigRootDir,
        },
      },
      plugins: {
        neverthrow: neverthrowPlugin as unknown as FlatConfigPlugin,
      },
      rules: {
        "neverthrow/must-use-result": "error",
        "neverthrow/no-throw-in-frontend": "error",
      },
    },
    {
      files: ["**/*.{js,ts,jsx,tsx}"],
      ignores: NON_FRONTEND_IGNORES,
      plugins: {
        neverthrow: neverthrowPlugin as unknown as FlatConfigPlugin,
      },
      rules: {
        "neverthrow/no-neverthrow-outside-frontend": "error",
      },
    },
  ] satisfies Linter.Config[];
}

function findMemberName(node: TSESTree.MemberExpression): null | string {
  return node.property.type === AST_NODE_TYPES.Identifier
    ? node.property.name
    : null;
}

function getAssignation(
  checker: ts.TypeChecker,
  parserServices: TypedParserServices,
  node: TSESTree.Node,
): null | TSESTree.Identifier {
  if (
    node.type === AST_NODE_TYPES.VariableDeclarator &&
    node.id.type === AST_NODE_TYPES.Identifier &&
    node.init &&
    isResultLike(checker, parserServices, node.init)
  ) {
    return node.id;
  }

  if (!node.parent || node.type === AST_NODE_TYPES.BlockStatement) {
    return null;
  }

  return getAssignation(checker, parserServices, node.parent);
}

function isHandledResult(node: TSESTree.Node): boolean {
  if (node.parent?.type !== AST_NODE_TYPES.MemberExpression) {
    return false;
  }
  const memberExpression = node.parent;

  const methodName = findMemberName(memberExpression);
  const methodIsCalled =
    memberExpression.parent.type === AST_NODE_TYPES.CallExpression &&
    memberExpression.parent.callee === memberExpression;

  if (methodName && HANDLED_METHODS.has(methodName) && methodIsCalled) {
    return true;
  }

  const parent = memberExpression.parent;
  return parent.type === AST_NODE_TYPES.ExpressionStatement
    ? false
    : isHandledResult(parent);
}

function isResultLike(
  checker: ts.TypeChecker,
  parserServices: TypedParserServices,
  node: null | TSESTree.Node,
): boolean {
  if (!node) {
    return false;
  }

  const tsNode = parserServices.esTreeNodeToTSNodeMap.get(node);
  const type = checker.getTypeAtLocation(tsNode);
  const apparentType = checker.getApparentType(type);

  return unionTypeParts(apparentType).some((part) =>
    RESULT_PROPERTIES.every(
      (property) => part.getProperty(property) !== undefined,
    ),
  );
}

function isReturned(node: TSESTree.Node): boolean {
  switch (node.type) {
    case AST_NODE_TYPES.ArrowFunctionExpression:
    case AST_NODE_TYPES.ReturnStatement: {
      return true;
    }
    case AST_NODE_TYPES.BlockStatement:
    case AST_NODE_TYPES.Program: {
      return false;
    }
    default: {
      return isReturned(node.parent);
    }
  }
}

function processResultSelector(
  context: TypedRuleContext<MustUseResultMessageIds>,
  checker: ts.TypeChecker,
  parserServices: TypedParserServices,
  node: TSESTree.Node,
  reportAs: TSESTree.Node = node,
): boolean {
  const parentType = node.parent?.type;
  if (parentType?.startsWith("TS")) {
    return false;
  }

  if (parentType && IGNORED_PARENT_TYPES.has(parentType)) {
    return false;
  }

  if (!isResultLike(checker, parserServices, node)) {
    return false;
  }

  if (isHandledResult(node) || isReturned(node)) {
    return false;
  }

  const assignedTo = getAssignation(checker, parserServices, node);
  if (assignedTo) {
    const currentScope = context.sourceCode.getScope(assignedTo);
    const variable = currentScope.set.get(assignedTo.name);
    const references =
      variable?.references.filter(
        (reference) => reference.identifier !== assignedTo,
      ) ?? [];

    if (references.length > 0) {
      return references.some((reference) =>
        processResultSelector(
          context,
          checker,
          parserServices,
          reference.identifier,
          reportAs,
        ),
      );
    }
  }

  context.report({
    messageId: "mustUseResult",
    node: reportAs,
  });
  return true;
}

function unionTypeParts(type: ts.Type): readonly ts.Type[] {
  return type.isUnion() ? type.types : [type];
}

const mustUseResultRule = createRule<RuleOptions, MustUseResultMessageIds>({
  create(context) {
    const parserServices = ESLintUtils.getParserServices(context);
    const checker = parserServices.program.getTypeChecker();

    return {
      [RESULT_SELECTOR](node: TSESTree.Node) {
        return processResultSelector(context, checker, parserServices, node);
      },
    };
  },
  defaultOptions: [],
  meta: {
    docs: {
      description:
        "Not handling neverthrow result is a possible error because errors could remain unhandled.",
      url: "",
    },
    messages: {
      mustUseResult:
        "Result must be handled with either of match, unwrapOr or _unsafeUnwrap.",
    },
    schema: [],
    type: "problem",
  },
  name: "must-use-result",
});

const noNeverthrowOutsideFrontendRule = createRule<
  RuleOptions,
  NeverthrowImportMessageIds
>({
  create(context) {
    return {
      ImportDeclaration(node) {
        if (node.source.value !== NEVERTHROW_MODULE_NAME) {
          return;
        }

        context.report({
          messageId: "noNeverthrowOutsideFrontend",
          node: node.source,
        });
      },
    };
  },
  defaultOptions: [],
  meta: {
    docs: {
      description:
        "Restrict neverthrow imports to src/ and components/ where the frontend error model applies.",
      url: "",
    },
    messages: {
      noNeverthrowOutsideFrontend:
        "neverthrow is only allowed in src/ and components/.",
    },
    schema: [],
    type: "problem",
  },
  name: "no-neverthrow-outside-frontend",
});

const noThrowInFrontendRule = createRule<RuleOptions, NoThrowMessageIds>({
  create(context) {
    return {
      ThrowStatement(node) {
        context.report({
          messageId: "noThrowInFrontend",
          node,
        });
      },
    };
  },
  defaultOptions: [],
  meta: {
    docs: {
      description:
        "Use neverthrow-based error propagation in src/ and components/ instead of throw.",
      url: "",
    },
    messages: {
      noThrowInFrontend:
        "Use neverthrow-based error propagation instead of throw in src/ and components/.",
    },
    schema: [],
    type: "problem",
  },
  name: "no-throw-in-frontend",
});

const neverthrowPlugin = {
  meta: {
    name: "praxisplaner-neverthrow",
  },
  rules: {
    "must-use-result": mustUseResultRule,
    "no-neverthrow-outside-frontend": noNeverthrowOutsideFrontendRule,
    "no-throw-in-frontend": noThrowInFrontendRule,
  },
};

export default neverthrowPlugin;
