import ts from "typescript";

const handledMethods = ["match", "unwrapOr", "_unsafeUnwrap"];
const ignoreParents = [
  "ClassDeclaration",
  "FunctionDeclaration",
  "MethodDefinition",
  "ClassProperty",
];
const resultProperties = [
  "mapErr",
  "map",
  "andThen",
  "orElse",
  "match",
  "unwrapOr",
];
const resultSelector = ":matches(CallExpression, NewExpression)";

function unionTypeParts(type) {
  return type.flags & ts.TypeFlags.Union ? type.types : [type];
}

function findMemberName(node) {
  if (!node || node.property.type !== "Identifier") {
    return null;
  }

  return node.property.name;
}

function getAssignation(checker, parserServices, node) {
  if (
    node.type === "VariableDeclarator" &&
    isResultLike(checker, parserServices, node.init) &&
    node.id.type === "Identifier"
  ) {
    return node.id;
  }

  if (
    !node.parent ||
    node.type === "BlockStatement" ||
    node.type === "Program"
  ) {
    return undefined;
  }

  return getAssignation(checker, parserServices, node.parent);
}

function isHandledResult(node) {
  const memberExpression = node.parent;
  if (memberExpression?.type !== "MemberExpression") {
    return false;
  }

  const methodName = findMemberName(memberExpression);
  const methodIsCalled =
    memberExpression.parent?.type === "CallExpression" &&
    memberExpression.parent.callee === memberExpression;

  if (methodName && handledMethods.includes(methodName) && methodIsCalled) {
    return true;
  }

  const parent = memberExpression.parent;
  if (parent && parent.type !== "ExpressionStatement") {
    return isHandledResult(parent);
  }

  return false;
}

function isResultLike(checker, parserServices, node) {
  if (!node) {
    return false;
  }

  const tsNode = parserServices.esTreeNodeToTSNodeMap.get(node);
  if (!tsNode) {
    return false;
  }

  const type = checker.getTypeAtLocation(tsNode);
  for (const part of unionTypeParts(checker.getApparentType(type))) {
    if (
      resultProperties
        .map((property) => part.getProperty(property))
        .every((property) => property !== undefined)
    ) {
      return true;
    }
  }

  return false;
}

function isReturned(node) {
  if (
    node.type === "ArrowFunctionExpression" ||
    node.type === "ReturnStatement"
  ) {
    return true;
  }

  if (node.type === "BlockStatement" || node.type === "Program") {
    return false;
  }

  if (!node.parent) {
    return false;
  }

  return isReturned(node.parent);
}

function processSelector(
  context,
  checker,
  parserServices,
  node,
  reportAs = node,
) {
  if (node.parent?.type.startsWith("TS")) {
    return false;
  }

  if (node.parent && ignoreParents.includes(node.parent.type)) {
    return false;
  }

  if (!isResultLike(checker, parserServices, node)) {
    return false;
  }

  if (isHandledResult(node)) {
    return false;
  }

  if (isReturned(node)) {
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
        processSelector(
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

const mustUseResultRule = {
  meta: {
    docs: {
      category: "Possible Errors",
      description:
        "Not handling neverthrow result is a possible error because errors could remain unhandled.",
      recommended: "error",
      url: "",
    },
    messages: {
      mustUseResult:
        "Result must be handled with either of match, unwrapOr or _unsafeUnwrap.",
    },
    schema: [],
    type: "problem",
  },
  create(context) {
    const parserServices =
      context.sourceCode.parserServices ?? context.parserServices;
    const checker = parserServices?.program?.getTypeChecker();

    if (!checker || !parserServices?.esTreeNodeToTSNodeMap) {
      throw new Error(
        "types not available, maybe you need set the parser to @typescript-eslint/parser",
      );
    }

    return {
      [resultSelector](node) {
        return processSelector(context, checker, parserServices, node);
      },
    };
  },
};

export default {
  rules: {
    "must-use-result": mustUseResultRule,
  },
};
