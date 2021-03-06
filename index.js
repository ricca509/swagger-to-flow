#!/usr/bin/env node
const fetch = require("node-fetch");
const fs = require("fs");
const https = require("https");
const changeCase = require("change-case");
const { DepGraph } = require("dependency-graph");
const swaggerToFlowTypes = require("./lib/swagger_to_flow_types");

if (!Object.entries) {
  require("object.entries").shim();
}

const graph = new DepGraph();

const argv = require("yargs")
  .usage("Usage: $0 -p [path] <options>")
  .alias("p", "path")
  .describe("p", "Path of swagger json file")
  .describe("transformProperty", "Transforms a property name")
  .describe("insecure", "Ignores SSL errors")
  .describe("changeTypeCase", "Changes type case to Pascal case")
  .choices("transformProperty", ["normal", "firstCaseLower"])
  .default("transformProperty", "normal")
  .default("changeTypeCase", false)
  .default("insecure", false)
  .example("$0 -p ../swagger.json", "Reads the file from the disk")
  .example(
    "$0 -p http://petstore.swagger.io/v2/swagger.json",
    "Fetches the file from URL"
  )
  .demandOption("p")
  .help().argv;

const isUrl = new RegExp("^(?:[a-z]+:)?//", "i");
const { path, insecure, transformProperty, changeTypeCase } = argv;

isUrl.test(path) ? fetchDefinitions(path) : readDefinitions(path);

function readDefinitions(file) {
  const json = fs.readFileSync(file, "utf-8");
  try {
    const definitions = processDefinitions(JSON.parse(json));
    printDefinitions(definitions);
  } catch (error) {
    console.log(error);
  }
}

function fetchDefinitions(url) {
  const agent = new https.Agent({ rejectUnauthorized: false });
  const options = Object.assign({}, insecure && { agent });

  return fetch(url, options)
    .then(response => response.json())
    .then(processDefinitions)
    .then(printDefinitions)
    .catch(e => {
      console.error(e.message);
    });
}

function processDefinitions(json) {
  let data = {};
  if (json.definitions) {
    for (let [key, value] of Object.entries(json.definitions)) {
      const name = getTypeName(key);
      graph.addNode(name);
      data[name] = `export type ${name} = ${processDefinition(name, value)}`;
    }

    return ["// @flow", ...graph.overallOrder().map(type => data[type])];
  } else {
    throw new Error("No swagger definitions to parse");
  }
}

function printDefinitions(definitions) {
  return definitions.map(definition => console.log(definition));
}

/**
 * Process the individual definition
 * @param name
 * @param data
 * @return {string}
 */
function processDefinition(name, data) {
  if (data.type == "object") {
    return `{\n\t${Object.entries(data.properties)
      .map(
        ([key, value]) =>
          `${parsePropertyName(key)}: ${parsePropertyType(value, name)}`
      )
      .join(",\n\t")}\n}`;
  } else {
    throw new Error(`Unable to parse ${data.type} for ${name}`);
  }
}

/**
 * Process the raw type
 * @param type
 * @return {string}
 */
function parsePropertyType(type, key) {
  if (type.type == "array") {
    if (type.items.type) {
      return `Array<${swaggerToFlowTypes[type.items.type]}>`;
    } else if (type.items["$ref"]) {
      const ref = getTypeName(type.items["$ref"].replace("#/definitions/", ""));
      addGraphDependency(key, ref);
      return `Array<${ref}>`;
    }
  } else if (!type.type && type["$ref"]) {
    const ref = getTypeName(type["$ref"].replace("#/definitions/", ""));
    addGraphDependency(key, ref);
    return ref;
  } else {
    return swaggerToFlowTypes[type.type];
  }
}

/**
 * Transform the property name if required
 * @param name
 * @return {string}
 */
function parsePropertyName(name) {
  switch (transformProperty) {
    case "firstCaseLower":
      return !/[a-z]/.test(name)
        ? // Doesn't have a single lower case character, probably need to make the entire word lower case
          name.toLowerCase()
        : changeCase.lowerCaseFirst(name);
  }

  return name;
}

function getTypeName(type) {
  return changeTypeCase ? changeCase.pascalCase(type) : type;
}

function addGraphDependency(parent, node) {
  graph.addNode(node);
  parent !== node && graph.addDependency(parent, node);
}
