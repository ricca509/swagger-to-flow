#!/usr/bin/env node
const fetch = require("node-fetch");
const fs = require("fs");
const https = require("https");
const changeCase = require("change-case");
const swaggerToFlowTypes = require("./lib/swagger_to_flow_types");

if (!Object.entries) {
  require("object.entries").shim();
}

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
    processDefinitions(JSON.parse(json));
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
    .catch(e => {
      console.error(e.message);
    });
}

function processDefinitions(json) {
  let data = ["// @flow"];
  if (json.definitions) {
    for (let [key, value] of Object.entries(json.definitions)) {
      const name = getTypeName(key);
      data.push(`export type ${name} = ${processDefinition(name, value)}`);
    }

    console.log(data.join("\n\n"));
  } else {
    throw new Error("No swagger definitions to parse");
  }
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
          `${parsePropertyName(key)}: ${parsePropertyType(value)}`
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
function parsePropertyType(type) {
  if (type.type == "array") {
    if (type.items.type) {
      return `Array<${swaggerToFlowTypes[type.items.type]}>`;
    } else if (type.items["$ref"]) {
      return `Array<${getTypeName(
        type.items["$ref"].replace("#/definitions/", "")
      )}>`;
    }
  } else if (!type.type && type["$ref"]) {
    const ref = type["$ref"].replace("#/definitions/", "");
    return getTypeName(ref);
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
  console.log(changeTypeCase, type);
  return changeTypeCase ? changeCase.pascalCase(type) : type;
}
