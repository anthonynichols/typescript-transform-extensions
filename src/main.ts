import path from 'path';
import {} from 'ts-expose-internals';
import {PluginConfig} from 'ttypescript/lib/PluginCreator';
import ts from 'typescript';
import url from 'url';

export interface TsTransformExtensionsConfig extends PluginConfig {
  extensions?: {[key: string]: string};
}

export default function transformer(program: ts.Program, config: TsTransformExtensionsConfig) {
  let compilerOptions = program.getCompilerOptions();
  let extensions = config.extensions ?? {};

  return (context: ts.TransformationContext) => (sourceFile: ts.SourceFile) => {
    let factory = context.factory;
    let fileName = sourceFile.fileName;
    let fileDir = ts.normalizePath(path.dirname(fileName));

    return ts.visitEachChild(sourceFile, visit, context);

    /**
     * Visit and replace nodes with module specifiers
     */
    function visit(node: ts.Node): ts.Node | undefined {
      // - Update `require()` or `import()`
      if (isRequire(node) || isAsyncImport(node)) {
        return update(node, (node.arguments[0] as ts.StringLiteral).text, (_path) => {
          let res =
            factory?.updateCallExpression(node, node.expression, node.typeArguments, [_path]) ??
            ts.updateCall(node, node.expression, node.typeArguments, [_path]);
          let textNode = node.arguments[0];
          let commentRanges = ts.getLeadingCommentRanges(textNode.getFullText(), 0) || [];

          for (let range of commentRanges) {
            let {kind, pos, end, hasTrailingNewLine} = range;
            let caption = textNode
              .getFullText()
              .substr(pos, end)
              .replace(
                /* searchValue */ kind === ts.SyntaxKind.MultiLineCommentTrivia
                  ? // Comment range in a multi-line comment with more than one line erroneously includes the
                    // node's text in the range. For that reason, we use the greedy selector in capture group
                    // and dismiss anything after the final comment close tag
                    /^\/\*(.+)\*\/.*/s
                  : /^\/\/(.+)/s,
                /* replaceValue */ '$1'
              );
            ts.addSyntheticLeadingComment(_path, kind, caption, hasTrailingNewLine);
          }

          return res;
        });
      }

      // - Update `ExternalModuleReference`, e.g., `import foo = require('foo');`
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        return update(node, node.moduleSpecifier.text, (_path) => {
          return factory
            ? Object.assign(node, {moduleSpecifier: _path})
            : Object.assign(node, {moduleSpecifier: (ts as any).updateNode(_path, node.moduleSpecifier)});
        });
      }

      // - Update `ImportTypeNode`, e.g., `typeof import('./bar');`
      if (ts.isImportTypeNode(node)) {
        let argument = node.argument as ts.LiteralTypeNode;

        if (!ts.isStringLiteral(argument.literal)) return node;

        let {text} = argument.literal;

        return !text
          ? node
          : update(node, text, (_path) => {
              return (
                factory?.updateImportTypeNode(
                  node,
                  factory.updateLiteralTypeNode(argument, _path),
                  node.qualifier,
                  node.typeArguments,
                  node.isTypeOf
                ) ??
                ts.updateImportTypeNode(
                  node,
                  ts.updateLiteralTypeNode(argument, _path),
                  node.qualifier,
                  node.typeArguments,
                  node.isTypeOf
                )
              );
            });
      }

      return ts.visitEachChild(node, visit, context);
    }

    function update(original: ts.Node, moduleName: string, updaterFn: (newPath: ts.StringLiteral) => ts.Node) {
      // - Have Compiler API attempt to resolve
      let {failedLookupLocations, resolvedModule} = ts.resolveModuleName(moduleName, fileName, compilerOptions, ts.sys);
      let _path: string;

      if (!resolvedModule) {
        let maybeUrl = failedLookupLocations[0];

        if (!isUrl(maybeUrl)) return original;

        _path = maybeUrl;
      } else if (resolvedModule.isExternalLibraryImport) {
        return original;
      } else {
        let {extension, resolvedFileName} = resolvedModule;
        let filePath = fileDir;
        let modulePath = path.dirname(resolvedFileName);

        _path = ts.normalizePath(path.join(path.relative(filePath, modulePath), path.basename(resolvedFileName)));

        if (extension && extension in extensions) {
          _path = _path.replace(extension, extensions[extension]);
        }

        if (!_path) return original;

        _path = _path[0] === "." ? _path : `./${_path}`;
      }

      return updaterFn(ts.createLiteral(_path));
    }
  };
}

// * ==========================================================================
// * Helpers
// * ==========================================================================
//#region Helpers

function isUrl(target: string) {
  return !!target && (!!url.parse(target).host || !!url.parse(target).hostname);
}

function isRequire(node: ts.Node): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'require' &&
    ts.isStringLiteral(node.arguments[0]) &&
    node.arguments.length === 1
  );
}

function isAsyncImport(node: ts.Node): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    node.expression.kind === ts.SyntaxKind.ImportKeyword &&
    ts.isStringLiteral(node.arguments[0]) &&
    node.arguments.length === 1
  );
}

//#endregion
