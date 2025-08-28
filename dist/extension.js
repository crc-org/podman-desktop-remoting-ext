'use strict';

Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

const extensionApi = require('@podman-desktop/api');

function _interopNamespaceDefault(e) {
  const n = Object.create(null, { [Symbol.toStringTag]: { value: 'Module' } });
  if (e) {
    for (const k in e) {
      if (k !== 'default') {
        const d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: () => e[k]
        });
      }
    }
  }
  n.default = e;
  return Object.freeze(n);
}

const extensionApi__namespace = /*#__PURE__*/_interopNamespaceDefault(extensionApi);

const SECOND = 1e9;
const path = require("path");
const fs = require("fs");
const async_fs = require("fs/promises");
const AvailableModels = {};
let ExtensionStoragePath = void 0;
const EXTENSION_BUILD_PATH = path.parse(__filename).dir + "/../build";
let RamalamaRemotingImage = void 0;
let ApirVersion = void 0;
let LocalBuildDir = void 0;
let StatusBar = void 0;
let NoAiLabModelWarningShown = false;
function setStatus(status) {
  console.log(`API Remoting status: ${status}`);
  if (StatusBar === void 0) {
    console.warn("Status bar not available ...");
    return;
  }
  if (status === void 0) {
    StatusBar.text = `Llama.cpp API Remoting`;
  } else {
    StatusBar.text = `Llama.cpp API Remoting: ${status}`;
  }
}
function registerFromDir(startPath, filter, register) {
  if (!fs.existsSync(startPath)) {
    console.log("no dir ", startPath);
    return;
  }
  var files = fs.readdirSync(startPath);
  for (var i = 0; i < files.length; i++) {
    var filename = path.join(startPath, files[i]);
    var stat = fs.lstatSync(filename);
    if (stat.isDirectory()) {
      registerFromDir(filename, filter, register);
    } else if (filename.endsWith(filter)) {
      register(filename);
    }
  }
}
async function copyRecursive(src, dest) {
  const entries = await async_fs.readdir(src, { withFileTypes: true });
  await async_fs.mkdir(dest, { recursive: true });
  for (let entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyRecursive(srcPath, destPath);
    } else {
      await async_fs.copyFile(srcPath, destPath);
    }
  }
}
const getRandomString = () => {
  return (Math.random() + 1).toString(36).substring(7);
};
function refreshAvailableModels() {
  if (ExtensionStoragePath === void 0) throw new Error("ExtensionStoragePath not defined :/");
  Object.keys(AvailableModels).forEach((key) => delete AvailableModels[key]);
  const registerModel = function(filename) {
    const dir_name = filename.split("/").at(-2);
    const name_parts = dir_name.split(".");
    const model_dir = name_parts.at(1);
    const model_name = name_parts.slice(2).join(".");
    const model_user_name = `${model_dir}/${model_name}`;
    AvailableModels[model_user_name] = filename;
    console.log(`found ${model_user_name}`);
  };
  registerFromDir(ExtensionStoragePath + "/../redhat.ai-lab/models", ".gguf", registerModel);
}
async function hasApirContainerRunning() {
  const containerInfo = (await extensionApi.containerEngine.listContainers()).find(
    (containerInfo2) => containerInfo2.Labels?.["llama-cpp.apir"] === "true" && containerInfo2.State === "running"
  );
  return containerInfo;
}
async function stopApirInferenceServer() {
  const containerInfo = await hasApirContainerRunning();
  if (containerInfo === void 0) {
    const msg = `🔴 Could not find an API Remoting container running ...`;
    setStatus(msg);
    await extensionApi__namespace.window.showErrorMessage(msg);
    return;
  }
  setStatus("⚙️ Stopping the inference server ...");
  await extensionApi.containerEngine.stopContainer(containerInfo.engineId, containerInfo.Id);
  await checkPodmanMachineStatus(false);
}
async function showRamalamaChat() {
  const containerInfo = await hasApirContainerRunning();
  if (containerInfo === void 0) {
    const msg = `🔴 Could not find an API Remoting container running ...`;
    setStatus(msg);
    await extensionApi__namespace.window.showErrorMessage(msg);
    return;
  }
  const api_url = containerInfo?.Labels?.api;
  if (!api_url) {
    const msg = "🔴 Missing API URL label on the running APIR container.";
    setStatus(msg);
    await extensionApi__namespace.window.showErrorMessage(msg);
    return;
  }
  await extensionApi__namespace.window.showInputBox({
    title: "ramalama chat",
    prompt: "RamaLama command to chat with the API Remoting model",
    multiline: true,
    value: `ramalama chat --url "${api_url}"`
  });
}
async function showRamalamaRun() {
  if (!RamalamaRemotingImage) {
    await extensionApi__namespace.window.showErrorMessage("APIR image is not loaded yet.");
    return;
  }
  await extensionApi__namespace.window.showInputBox({
    title: "ramalama run",
    prompt: "RamaLama command to launch a model",
    multiline: true,
    value: `ramalama run --image "${RamalamaRemotingImage}" llama3.2`
  });
}
async function showRamalamaBenchmark() {
  if (!RamalamaRemotingImage) {
    await extensionApi__namespace.window.showErrorMessage("APIR image is not loaded yet.");
    return;
  }
  await extensionApi__namespace.window.showInputBox({
    title: "ramalama bench",
    prompt: "RamaLama commands to run benchmarks",
    multiline: true,
    value: `
# Venus-Vulkan benchmarking
ramalama bench llama3.2

# Native Metal benchmarking (needs \`llama-bench\` installed)
ramalama --nocontainer bench llama3.2

# API Remoting benchmark
ramalama bench  --image "${RamalamaRemotingImage}" llama3.2
# (scroll up to see more)`
  });
}
async function launchApirInferenceServer() {
  const containerInfo = await hasApirContainerRunning();
  if (containerInfo !== void 0) {
    const id2 = containerInfo.Id;
    console.error(`API Remoting container ${id2} already running ...`);
    await extensionApi__namespace.window.showErrorMessage(`🟠 API Remoting container ${id2} is already running. This version cannot have two API Remoting containers running simultaneously.`);
    return;
  }
  if (RamalamaRemotingImage === void 0) throw new Error("Ramalama Remoting image name not loaded. This is unexpected.");
  setStatus("⚙️ Configuring the inference server ...");
  let model_name;
  if (Object.keys(AvailableModels).length === 0) {
    if (!NoAiLabModelWarningShown) {
      await extensionApi__namespace.window.showInformationMessage(`🟠 Could not find any model downloaded from AI Lab. Please select a GGUF file to load.`);
      NoAiLabModelWarningShown = true;
    }
    let uris = await extensionApi__namespace.window.showOpenDialog({
      title: "Select a GGUF model file",
      openLabel: "Select",
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: { "GGUF Models": ["gguf"] }
    });
    if (!uris || uris.length === 0) {
      console.log("No model selected, aborting the APIR container launch silently.");
      return;
    }
    model_name = uris[0].fsPath;
    if (!fs.existsSync(model_name)) {
      const msg = `Selected GGUF model file does not exist: ${model_name}`;
      console.warn(msg);
      await extensionApi__namespace.window.showErrorMessage(msg);
      return;
    }
  } else {
    refreshAvailableModels();
    model_name = await extensionApi__namespace.window.showQuickPick(Object.keys(AvailableModels), {
      canPickMany: false,
      // user can select more than one choice
      title: "Choose the model to deploy"
    });
    if (model_name === void 0) {
      console.warn("No model chosen, nothing to launch.");
      return;
    }
  }
  const host_port_str = await extensionApi__namespace.window.showInputBox({
    title: "Service port",
    prompt: "Inference service port on the host",
    value: "1234",
    validateInput: (value) => parseInt(value, 10) > 1024 ? "" : "Enter a valid port > 1024"
  });
  const host_port = host_port_str ? parseInt(host_port_str, 10) : Number.NaN;
  if (Number.isNaN(host_port)) {
    console.warn("No host port chosen, nothing to launch.");
    return;
  }
  setStatus("⚙️ Pulling the image ...");
  const imageInfo = await pullImage(
    RamalamaRemotingImage);
  setStatus("⚙️ Creating the container ...");
  const model_src = AvailableModels[model_name] ?? model_name;
  if (model_src === void 0)
    throw new Error(`Couldn't get the file associated with model ${model_src}. This is unexpected.`);
  const model_filename = path.basename(model_src);
  const model_dirname = path.basename(path.dirname(model_src));
  const model_dest = `/models/${model_filename}`;
  const ai_lab_port = 10434;
  const labels = {
    ["ai-lab-inference-server"]: JSON.stringify([model_dirname]),
    ["api"]: `http://127.0.0.1:${host_port}/v1`,
    ["docs"]: `http://127.0.0.1:${ai_lab_port}/api-docs/${host_port}`,
    ["gpu"]: `llama.cpp API Remoting`,
    ["trackingId"]: getRandomString(),
    ["llama-cpp.apir"]: "true"
  };
  const mounts = [
    {
      Target: model_dest,
      Source: model_src,
      Type: "bind",
      ReadOnly: true
    }
  ];
  let entrypoint = void 0;
  let cmd = [];
  entrypoint = "/usr/bin/llama-server.sh";
  const envs = [`MODEL_PATH=${model_dest}`, "HOST=0.0.0.0", "PORT=8000", "GPU_LAYERS=999"];
  const devices = [];
  devices.push({
    PathOnHost: "/dev/dri",
    PathInContainer: "/dev/dri",
    CgroupPermissions: ""
  });
  const deviceRequests = [];
  deviceRequests.push({
    Capabilities: [["gpu"]],
    Count: -1
    // -1: all
  });
  const containerCreateOptions = {
    Image: imageInfo.Id,
    Detach: true,
    Entrypoint: entrypoint,
    Cmd: cmd,
    ExposedPorts: { [`${host_port}/tcp`]: {} },
    HostConfig: {
      AutoRemove: false,
      Devices: devices,
      Mounts: mounts,
      DeviceRequests: deviceRequests,
      SecurityOpt: ["label=disable"],
      PortBindings: {
        "8000/tcp": [
          {
            HostPort: `${host_port}`
          }
        ]
      }
    },
    HealthCheck: {
      // must be the port INSIDE the container not the exposed one
      Test: ["CMD-SHELL", `curl -sSf localhost:8000 > /dev/null`],
      Interval: SECOND * 5,
      Retries: 4 * 5
    },
    Labels: labels,
    Env: envs
  };
  console.log(containerCreateOptions, mounts);
  const { engineId, id } = await createContainer(imageInfo.engineId, containerCreateOptions);
  setStatus(`🎉 Inference server is ready on port ${host_port}`);
  await extensionApi__namespace.window.showInformationMessage(`🎉 ${model_name} is running with API Remoting acceleration!`);
}
async function createContainer(engineId, containerCreateOptions, labels) {
  console.log("Creating container ...");
  try {
    const result = await extensionApi.containerEngine.createContainer(engineId, containerCreateOptions);
    console.log("Container created!");
    return {
      id: result.id,
      engineId
    };
  } catch (err) {
    const msg = `Container creation failed :/ ${String(err)}`;
    console.error(msg);
    setStatus("🔴 Container creation failed");
    await extensionApi__namespace.window.showErrorMessage(msg);
    throw err;
  }
}
function getConnection(allowUndefined = false) {
  const providers = extensionApi.provider.getContainerConnections();
  const podmanProvider = providers.find(({ connection: connection2 }) => connection2.type === "podman" && connection2.status() === "started");
  if (!podmanProvider) {
    if (allowUndefined) {
      return void 0;
    } else {
      throw new Error("cannot find podman provider");
    }
  }
  let connection = podmanProvider.connection;
  return connection;
}
async function pullImage(image, labels) {
  console.log(`Pulling the image ${image} ...`);
  const connection = getConnection();
  return getImageInfo(connection, image, (_event) => {
  }).catch((err) => {
    console.error(`Something went wrong while pulling ${image}: ${String(err)}`);
    throw err;
  }).then((imageInfo) => {
    console.log("Image pulled successfully");
    return imageInfo;
  });
}
async function getImageInfo(connection, image, callback) {
  let imageInfo = void 0;
  try {
    await extensionApi.containerEngine.pullImage(connection, image, callback);
    imageInfo = (await extensionApi.containerEngine.listImages({
      provider: connection
    })).find((imageInfo2) => imageInfo2.RepoTags?.some((tag) => tag === image));
  } catch (err) {
    console.warn("Something went wrong while trying to get image inspect", err);
    await extensionApi__namespace.window.showErrorMessage(`Something went wrong while trying to get image inspect: ${err}`);
    throw err;
  }
  if (imageInfo === void 0) throw new Error(`image ${image} not found.`);
  return imageInfo;
}
async function initializeBuildDir(buildPath) {
  console.log(`Initializing the build directory from ${buildPath} ...`);
  ApirVersion = (await async_fs.readFile(buildPath + "/src_info/version.txt", "utf8")).replace(/\n$/, "");
  if (RamalamaRemotingImage === void 0)
    RamalamaRemotingImage = (await async_fs.readFile(buildPath + "/src_info/ramalama.image-info.txt", "utf8")).replace(/\n$/, "");
}
async function initializeStorageDir(storagePath, buildPath) {
  console.log(`Initializing the storage directory ...`);
  if (!fs.existsSync(storagePath)) {
    fs.mkdirSync(storagePath);
  }
  if (ApirVersion === void 0) throw new Error("APIR version not loaded. This is unexpected.");
  LocalBuildDir = `${storagePath}/${ApirVersion}`;
  if (!fs.existsSync(LocalBuildDir)) {
    await copyRecursive(buildPath, LocalBuildDir);
    console.log("Copy complete");
  }
}
async function activate(extensionContext) {
  ExtensionStoragePath = extensionContext.storagePath;
  console.log("Activating the API Remoting extension ...");
  const menuCommand = extensionApi__namespace.commands.registerCommand("llama.cpp.apir.menu", async () => {
    if (!extensionApi__namespace.env.isMac) {
      await extensionApi__namespace.window.showErrorMessage(`llama.cpp API Remoting only supported on MacOS.`);
      return;
    }
    let status = "(status is undefined)";
    try {
      status = await checkPodmanMachineStatus(false);
    } catch (err) {
      await extensionApi__namespace.window.showErrorMessage(err);
      return;
    }
    const main_menu_choices = {};
    let status_str;
    if (status === 127) {
      status_str = "API Remoting binaries are not installed";
      main_menu_choices["Reinstall the API Remoting binaries"] = installApirBinaries;
    } else if (status === 0 || status === 1) {
      if (status === 0) {
        status_str = "VM is running with API Remoting 🎉";
        main_menu_choices["Launch an API Remoting accelerated Inference Server"] = launchApirInferenceServer;
        main_menu_choices["Show RamaLama model launch command"] = showRamalamaRun;
        main_menu_choices["Show RamaLama benchmark commands"] = showRamalamaBenchmark;
      } else {
        status_str = "an API Remoting inference server is already running";
        main_menu_choices["Show RamaLama chat command"] = showRamalamaChat;
        main_menu_choices["Stop the API Remoting Inference Server"] = stopApirInferenceServer;
      }
      main_menu_choices["---"] = function() {
      };
      main_menu_choices["Restart PodMan Machine without API Remoting"] = restart_podman_machine_without_apir;
    } else if (status === 10 || status === 11 || status === 12) {
      if (status === 10) {
        status_str = "VM is running with vfkit";
      } else if (status === 11) {
        status_str = "VM is not running";
      } else if (status === 12) {
        status_str = "VM is running without API Remoting";
      }
      main_menu_choices["Restart PodMan Machine with API Remoting support"] = restart_podman_machine_with_apir;
      main_menu_choices["Uninstall the API Remoting binaries"] = uninstallApirBinaries;
    }
    main_menu_choices["---"] = function() {
    };
    main_menu_choices["Check PodMan Machine API Remoting status"] = () => checkPodmanMachineStatus(true);
    const result = await extensionApi__namespace.window.showQuickPick(Object.keys(main_menu_choices), {
      title: `What do
you want to do? (${status_str})`,
      canPickMany: false
      // user can select more than one choice
    });
    if (result === void 0) {
      console.log("No user choice, aborting.");
      return;
    }
    try {
      await main_menu_choices[result]();
    } catch (err) {
      const msg = `Task failed: ${String(err)}`;
      console.error(msg);
      await extensionApi__namespace.window.showErrorMessage(msg);
      throw err;
    }
  });
  try {
    StatusBar = extensionApi__namespace.window.createStatusBarItem(extensionApi__namespace.StatusBarAlignLeft, 100);
    setStatus("⚙️ Initializing ...");
    StatusBar.command = "llama.cpp.apir.menu";
    StatusBar.show();
    extensionContext.subscriptions.push(menuCommand);
    extensionContext.subscriptions.push(StatusBar);
  } catch (error) {
    const msg = `Couldn't subscribe the extension to Podman Desktop: ${error}`;
    await extensionApi__namespace.window.showErrorMessage(msg);
    throw new Error(msg);
  }
  try {
    setStatus("Installing ...");
    await installApirBinaries();
  } catch (error) {
    return;
  }
  setStatus(`⚙️ Loading the models ...`);
  try {
    refreshAvailableModels();
  } catch (error) {
    const msg = `Couldn't initialize the extension: ${error}`;
    await extensionApi__namespace.window.showErrorMessage(msg);
    setStatus(`🔴 ${msg}`);
    return;
  }
  setStatus();
}
async function deactivate() {
}
async function installApirBinaries() {
  try {
    await initializeBuildDir(EXTENSION_BUILD_PATH);
    console.log(`Installing APIR version ${ApirVersion} ...`);
    StatusBar.tooltip = `version ${ApirVersion}`;
    console.log(`Using image ${RamalamaRemotingImage}`);
    setStatus(`⚙️ Extracting the binaries ...`);
    await initializeStorageDir(ExtensionStoragePath, EXTENSION_BUILD_PATH);
    setStatus(`⚙️ Preparing krunkit ...`);
    await prepare_krunkit();
    setStatus(`✅ binaries installed`);
  } catch (error) {
    const msg = `Couldn't initialize the extension: ${error}`;
    setStatus(`🔴 ${msg}`);
    await extensionApi__namespace.window.showErrorMessage(msg);
    throw error;
  }
}
async function uninstallApirBinaries() {
  if (ExtensionStoragePath === void 0) throw new Error("ExtensionStoragePath not defined :/");
  setStatus(`⚙️ Uninstalling the binaries ...`);
  const toDelete = [];
  registerFromDir(ExtensionStoragePath, "check_podman_machine_status.sh", function(filename) {
    toDelete.push(path.dirname(filename));
  });
  for (const dirName of toDelete) {
    console.warn("⚠️ deleting APIR directory: ", dirName);
    fs.rmSync(dirName, { recursive: true, force: true });
  }
  console.warn("⚠️ deleting done");
  setStatus(`✅ binaries uninstalled 👋`);
}
async function getConnectionName(allowUndefined = false) {
  try {
    const connection = getConnection(allowUndefined);
    const connectionName = connection?.["name"];
    if (!allowUndefined && connectionName === void 0) {
      throw new Error("cannot find podman connection name");
    }
    if (connectionName) {
      console.log("Connecting to", connectionName);
    }
    return connectionName;
  } catch (error) {
    const msg = `Failed to get the default connection to Podman: ${error}`;
    await extensionApi__namespace.window.showErrorMessage(msg);
    console.error(msg);
    setStatus(`🔴 ${msg}`);
    throw new Error(msg);
  }
}
async function restart_podman_machine_with_apir() {
  if (LocalBuildDir === void 0) throw new Error("LocalBuildDir not loaded. This is unexpected.");
  const connectionName = await getConnectionName();
  try {
    setStatus("⚙️ Restarting PodMan Machine with API Remoting support ...");
    const { stdout } = await extensionApi__namespace.process.exec("/usr/bin/env", ["bash", `${LocalBuildDir}/podman_start_machine.api_remoting.sh`, connectionName], { cwd: LocalBuildDir });
    const msg = "🟢 PodMan Machine successfully restarted with API Remoting support";
    await extensionApi__namespace.window.showInformationMessage(msg);
    console.log(msg);
    setStatus("🟢 API Remoting support enabled");
  } catch (error) {
    const msg = `Failed to restart PodMan Machine with the API Remoting support: ${error}`;
    await extensionApi__namespace.window.showErrorMessage(msg);
    console.error(msg);
    setStatus(`🔴 ${msg}`);
    throw new Error(msg);
  }
}
async function restart_podman_machine_without_apir() {
  const connectionName = await getConnectionName();
  try {
    setStatus("⚙️ Stopping the PodMan Machine ...");
    const { stdout } = await extensionApi__namespace.process.exec("podman", ["machine", "stop", connectionName]);
  } catch (error) {
    const msg2 = `Failed to stop the PodMan Machine: ${error}`;
    setStatus(`🔴 ${msg2}`);
    await extensionApi__namespace.window.showErrorMessage(msg2);
    console.error(msg2);
    throw new Error(msg2);
  }
  try {
    setStatus("⚙️ Restarting the default PodMan Machine ...");
    const { stdout } = await extensionApi__namespace.process.exec("podman", ["machine", "start", connectionName]);
  } catch (error) {
    const msg2 = `Failed to restart the PodMan Machine: ${error}`;
    setStatus(`🔴 ${msg2}`);
    await extensionApi__namespace.window.showErrorMessage(msg2);
    console.error(msg2);
    throw new Error(msg2);
  }
  const msg = "PodMan Machine successfully restarted without API Remoting support";
  await extensionApi__namespace.window.showInformationMessage(msg);
  console.log(msg);
  setStatus("🟠 Running without API Remoting support");
}
async function prepare_krunkit() {
  if (LocalBuildDir === void 0) throw new Error("LocalBuildDir not loaded. This is unexpected.");
  if (fs.existsSync(`${LocalBuildDir}/bin/krunkit`)) {
    console.log("Binaries already prepared.");
    return;
  }
  setStatus(`⚙️ Preparing the krunkit binaries for API Remoting ...`);
  if (!fs.existsSync(`${LocalBuildDir}/update_krunkit.sh`)) {
    const msg = `Cannot prepare the krunkit binaries: ${LocalBuildDir}/update_krunkit.sh does not exist`;
    console.error(msg);
    throw new Error(msg);
  }
  try {
    const { stdout } = await extensionApi__namespace.process.exec("/usr/bin/env", ["bash", `${LocalBuildDir}/update_krunkit.sh`], { cwd: LocalBuildDir });
  } catch (error) {
    console.error(error);
    throw new Error(`Couldn't update the krunkit binaries: ${error}: ${error.stdout}`);
  }
  setStatus(`✅ binaries prepared!`);
}
async function checkPodmanMachineStatus(with_gui) {
  if (!fs.existsSync(`${LocalBuildDir}/check_podman_machine_status.sh`)) {
    console.log(`checkPodmanMachineStatus: script not found in ${LocalBuildDir}`);
    setStatus("⛔ not installed");
    if (with_gui) {
      await extensionApi__namespace.window.showInformationMessage("⛔ API Remoting binaries are not installed");
    }
    return 127;
  }
  try {
    const { stdout } = await extensionApi__namespace.process.exec("/usr/bin/env", ["bash", `${LocalBuildDir}/check_podman_machine_status.sh`], { cwd: LocalBuildDir });
    const status = stdout.replace(/\n$/, "");
    const msg = `Podman Machine API Remoting status:
${status}`;
    if (with_gui) {
      await extensionApi__namespace.window.showInformationMessage(msg);
    }
    console.log(msg);
    const containerInfo = await hasApirContainerRunning();
    if (containerInfo !== void 0) {
      setStatus(`🟢 Inference Server running`);
      return 1;
    } else {
      setStatus("🟢");
      return 0;
    }
  } catch (error) {
    let msg;
    const status = error.stdout.replace(/\n$/, "");
    const exitCode = error.exitCode;
    if (exitCode > 10 && exitCode < 20) {
      msg = `🟠 Podman Machine status: ${status}`;
      if (with_gui) {
        await extensionApi__namespace.window.showInformationMessage(msg);
      }
      console.warn(msg);
      if (exitCode === 10 || exitCode === 12) {
        setStatus("🟠 PodMan Machine running without API Remoting support");
      } else if (exitCode === 11) {
        setStatus("🟠 PodMan Machine not running");
      } else {
        setStatus(`🔴 Invalid check status ${exitCode}`);
        console.warn(`Invalid check status ${exitCode}: ${error.stdout}`);
      }
      return exitCode;
    }
    msg = `Failed to check PodMan Machine status: ${status} (code #${exitCode})`;
    await extensionApi__namespace.window.showErrorMessage(msg);
    console.error(msg);
    setStatus(`🔴 ${msg}`);
    throw new Error(msg);
  }
}

exports.SECOND = SECOND;
exports.activate = activate;
exports.deactivate = deactivate;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZXh0ZW5zaW9uLmpzIiwic291cmNlcyI6WyIuLi9zcmMvZXh0ZW5zaW9uLnRzIl0sInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB0eXBlIHtcbiAgICBDb250YWluZXJDcmVhdGVPcHRpb25zLFxuICAgIENvbnRhaW5lckNyZWF0ZVJlc3VsdCxcbiAgICBDb250YWluZXJQcm92aWRlckNvbm5lY3Rpb24sXG4gICAgRGV2aWNlLFxuICAgIExpc3RJbWFnZXNPcHRpb25zLFxuICAgIFB1bGxFdmVudCxcbiAgICBEZXZpY2VSZXF1ZXN0LFxuICAgIEltYWdlSW5mbyxcbiAgICBNb3VudENvbmZpZyxcbiAgICBQcm92aWRlckNvbnRhaW5lckNvbm5lY3Rpb24sXG59IGZyb20gJ0Bwb2RtYW4tZGVza3RvcC9hcGknO1xuXG5pbXBvcnQgKiBhcyBleHRlbnNpb25BcGkgZnJvbSAnQHBvZG1hbi1kZXNrdG9wL2FwaSc7XG5pbXBvcnQgdHlwZSB7IFBvZG1hbkNvbm5lY3Rpb24gfSBmcm9tICcuLi8uLi9tYW5hZ2Vycy9wb2RtYW5Db25uZWN0aW9uJztcbmltcG9ydCAqIGFzIFBvZG1hbkNvbm5lY3Rpb25BUEkgZnJvbSAnLi4vLi4vbWFuYWdlcnMvcG9kbWFuQ29ubmVjdGlvbic7XG5pbXBvcnQgeyBjb250YWluZXJFbmdpbmUsIHByb3ZpZGVyLCBQcm9ncmVzc0xvY2F0aW9uIH0gZnJvbSAnQHBvZG1hbi1kZXNrdG9wL2FwaSc7XG5cbmV4cG9ydCBjb25zdCBTRUNPTkQ6IG51bWJlciA9IDFfMDAwXzAwMF8wMDA7XG5cbmNvbnN0IHBhdGggPSByZXF1aXJlKCdwYXRoJyk7XG5jb25zdCBmcyA9IHJlcXVpcmUoJ2ZzJyk7XG5jb25zdCBhc3luY19mcyA9IHJlcXVpcmUoJ2ZzL3Byb21pc2VzJyk7XG5cbmNvbnN0IEF2YWlsYWJsZU1vZGVscyA9IHt9O1xubGV0IEV4dGVuc2lvblN0b3JhZ2VQYXRoID0gdW5kZWZpbmVkO1xuXG5jb25zdCBGQUlMX0lGX05PVF9NQUMgPSB0cnVlO1xuY29uc3QgRVhURU5TSU9OX0JVSUxEX1BBVEggPSBwYXRoLnBhcnNlKF9fZmlsZW5hbWUpLmRpciArIFwiLy4uL2J1aWxkXCI7XG5jb25zdCBSRVNUUklDVF9PUEVOX1RPX0dHVUZfRklMRVMgPSBmYWxzZTtcbmNvbnN0IFNFQVJDSF9BSV9MQUJfTU9ERUxTID0gdHJ1ZTtcblxubGV0IFJhbWFsYW1hUmVtb3RpbmdJbWFnZSA9IHVuZGVmaW5lZDtcbmxldCBBcGlyVmVyc2lvbiA9IHVuZGVmaW5lZDtcbmxldCBMb2NhbEJ1aWxkRGlyID0gdW5kZWZpbmVkO1xubGV0IFN0YXR1c0JhciA9IHVuZGVmaW5lZDtcbmxldCBOb0FpTGFiTW9kZWxXYXJuaW5nU2hvd24gPSBmYWxzZTtcblxuZnVuY3Rpb24gc2V0U3RhdHVzKHN0YXR1cykge1xuICAgIGNvbnNvbGUubG9nKGBBUEkgUmVtb3Rpbmcgc3RhdHVzOiAke3N0YXR1c31gKVxuICAgIGlmIChTdGF0dXNCYXIgPT09IHVuZGVmaW5lZCkge1xuXHRjb25zb2xlLndhcm4oXCJTdGF0dXMgYmFyIG5vdCBhdmFpbGFibGUgLi4uXCIpO1xuXHRyZXR1cm47XG4gICAgfVxuICAgIGlmIChzdGF0dXMgPT09IHVuZGVmaW5lZCkge1xuXHRTdGF0dXNCYXIudGV4dCA9IGBMbGFtYS5jcHAgQVBJIFJlbW90aW5nYFxuICAgIH0gZWxzZSB7XG5cdFN0YXR1c0Jhci50ZXh0ID0gYExsYW1hLmNwcCBBUEkgUmVtb3Rpbmc6ICR7c3RhdHVzfWBcbiAgICB9XG59XG5cbmZ1bmN0aW9uIHJlZ2lzdGVyRnJvbURpcihzdGFydFBhdGgsIGZpbHRlciwgcmVnaXN0ZXIpIHtcbiAgICBpZiAoIWZzLmV4aXN0c1N5bmMoc3RhcnRQYXRoKSkge1xuICAgICAgICBjb25zb2xlLmxvZyhcIm5vIGRpciBcIiwgc3RhcnRQYXRoKTtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHZhciBmaWxlcyA9IGZzLnJlYWRkaXJTeW5jKHN0YXJ0UGF0aCk7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBmaWxlcy5sZW5ndGg7IGkrKykge1xuICAgICAgICB2YXIgZmlsZW5hbWUgPSBwYXRoLmpvaW4oc3RhcnRQYXRoLCBmaWxlc1tpXSk7XG4gICAgICAgIHZhciBzdGF0ID0gZnMubHN0YXRTeW5jKGZpbGVuYW1lKTtcbiAgICAgICAgaWYgKHN0YXQuaXNEaXJlY3RvcnkoKSkge1xuICAgICAgICAgICAgcmVnaXN0ZXJGcm9tRGlyKGZpbGVuYW1lLCBmaWx0ZXIsIHJlZ2lzdGVyKTsgLy9yZWN1cnNlXG4gICAgICAgIH0gZWxzZSBpZiAoZmlsZW5hbWUuZW5kc1dpdGgoZmlsdGVyKSkge1xuICAgICAgICAgICAgcmVnaXN0ZXIoZmlsZW5hbWUpO1xuICAgICAgICB9O1xuICAgIH07XG59O1xuXG4vLyBnZW5lcmF0ZWQgYnkgY2hhdGdwdFxuYXN5bmMgZnVuY3Rpb24gY29weVJlY3Vyc2l2ZShzcmMsIGRlc3QpIHtcbiAgY29uc3QgZW50cmllcyA9IGF3YWl0IGFzeW5jX2ZzLnJlYWRkaXIoc3JjLCB7IHdpdGhGaWxlVHlwZXM6IHRydWUgfSk7XG5cbiAgYXdhaXQgYXN5bmNfZnMubWtkaXIoZGVzdCwgeyByZWN1cnNpdmU6IHRydWUgfSk7XG5cbiAgZm9yIChsZXQgZW50cnkgb2YgZW50cmllcykge1xuICAgIGNvbnN0IHNyY1BhdGggPSBwYXRoLmpvaW4oc3JjLCBlbnRyeS5uYW1lKTtcbiAgICBjb25zdCBkZXN0UGF0aCA9IHBhdGguam9pbihkZXN0LCBlbnRyeS5uYW1lKTtcblxuICAgIGlmIChlbnRyeS5pc0RpcmVjdG9yeSgpKSB7XG4gICAgICBhd2FpdCBjb3B5UmVjdXJzaXZlKHNyY1BhdGgsIGRlc3RQYXRoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgYXdhaXQgYXN5bmNfZnMuY29weUZpbGUoc3JjUGF0aCwgZGVzdFBhdGgpO1xuICAgIH1cbiAgfVxufVxuXG5jb25zdCBnZXRSYW5kb21TdHJpbmcgPSAoKTogc3RyaW5nID0+IHtcbiAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIHNvbmFyanMvcHNldWRvLXJhbmRvbVxuICByZXR1cm4gKE1hdGgucmFuZG9tKCkgKyAxKS50b1N0cmluZygzNikuc3Vic3RyaW5nKDcpO1xufTtcblxuZnVuY3Rpb24gcmVmcmVzaEF2YWlsYWJsZU1vZGVscygpIHtcbiAgICBpZiAoIVNFQVJDSF9BSV9MQUJfTU9ERUxTKSB7XG5cdGNvbnNvbGUubG9nKFwiU2VhcmNoaW5nIEFJIGxhYiBtb2RlbHMgaXMgZGlzYWJsZWQuIFNraXBwaW5nIHJlZnJlc2hBdmFpbGFibGVNb2RlbHMuXCIpXG5cdHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAoRXh0ZW5zaW9uU3RvcmFnZVBhdGggPT09IHVuZGVmaW5lZCkgdGhyb3cgbmV3IEVycm9yKCdFeHRlbnNpb25TdG9yYWdlUGF0aCBub3QgZGVmaW5lZCA6LycpO1xuXG4gICAgLy8gZGVsZXRlIHRoZSBleGlzdGluZyBtb2RlbHNcbiAgICBPYmplY3Qua2V5cyhBdmFpbGFibGVNb2RlbHMpLmZvckVhY2goa2V5ID0+IGRlbGV0ZSBBdmFpbGFibGVNb2RlbHNba2V5XSk7XG5cbiAgICBjb25zdCByZWdpc3Rlck1vZGVsID0gZnVuY3Rpb24oZmlsZW5hbWUpIHtcbiAgICAgICAgY29uc3QgZGlyX25hbWUgPSBmaWxlbmFtZS5zcGxpdChcIi9cIikuYXQoLTIpXG4gICAgICAgIGNvbnN0IG5hbWVfcGFydHMgPSBkaXJfbmFtZS5zcGxpdChcIi5cIilcbiAgICAgICAgLy8gMCBpcyB0aGUgc291cmNlIChlZywgaGYpXG4gICAgICAgIGNvbnN0IG1vZGVsX2RpciA9IG5hbWVfcGFydHMuYXQoMSlcbiAgICAgICAgY29uc3QgbW9kZWxfbmFtZSA9IG5hbWVfcGFydHMuc2xpY2UoMikuam9pbignLicpXG4gICAgICAgIGNvbnN0IG1vZGVsX3VzZXJfbmFtZSA9IGAke21vZGVsX2Rpcn0vJHttb2RlbF9uYW1lfWBcbiAgICAgICAgQXZhaWxhYmxlTW9kZWxzW21vZGVsX3VzZXJfbmFtZV0gPSBmaWxlbmFtZTtcbiAgICAgICAgY29uc29sZS5sb2coYGZvdW5kICR7bW9kZWxfdXNlcl9uYW1lfWApXG4gICAgfVxuXG4gICAgcmVnaXN0ZXJGcm9tRGlyKEV4dGVuc2lvblN0b3JhZ2VQYXRoICsgJy8uLi9yZWRoYXQuYWktbGFiL21vZGVscycsICcuZ2d1ZicsIHJlZ2lzdGVyTW9kZWwpO1xufVxuXG5mdW5jdGlvbiBzbGVlcChtcykge1xuICByZXR1cm4gbmV3IFByb21pc2UocmVzb2x2ZSA9PiBzZXRUaW1lb3V0KHJlc29sdmUsIG1zKSk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGhhc0FwaXJDb250YWluZXJSdW5uaW5nKCkge1xuICAgIGNvbnN0IGNvbnRhaW5lckluZm8gPSAoYXdhaXQgY29udGFpbmVyRW5naW5lLmxpc3RDb250YWluZXJzKCkpLmZpbmQoXG5cdGNvbnRhaW5lckluZm8gPT5cblx0Y29udGFpbmVySW5mby5MYWJlbHM/LlsnbGxhbWEtY3BwLmFwaXInXSA9PT0gJ3RydWUnICYmXG5cdCAgICBjb250YWluZXJJbmZvLlN0YXRlID09PSAncnVubmluZycsXG4gICAgKTtcblxuICAgIHJldHVybiBjb250YWluZXJJbmZvO1xufVxuXG5hc3luYyBmdW5jdGlvbiBzdG9wQXBpckluZmVyZW5jZVNlcnZlcigpIHtcbiAgICBjb25zdCBjb250YWluZXJJbmZvID0gYXdhaXQgaGFzQXBpckNvbnRhaW5lclJ1bm5pbmcoKTtcbiAgICBpZiAoY29udGFpbmVySW5mbyA9PT0gdW5kZWZpbmVkKSB7XG5cdGNvbnN0IG1zZyA9IGDwn5S0IENvdWxkIG5vdCBmaW5kIGFuIEFQSSBSZW1vdGluZyBjb250YWluZXIgcnVubmluZyAuLi5gXG5cdHNldFN0YXR1cyhtc2cpO1xuICAgICAgICBhd2FpdCBleHRlbnNpb25BcGkud2luZG93LnNob3dFcnJvck1lc3NhZ2UobXNnKTtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBzZXRTdGF0dXMoXCLimpnvuI8gU3RvcHBpbmcgdGhlIGluZmVyZW5jZSBzZXJ2ZXIgLi4uXCIpXG4gICAgYXdhaXQgY29udGFpbmVyRW5naW5lLnN0b3BDb250YWluZXIoY29udGFpbmVySW5mby5lbmdpbmVJZCwgY29udGFpbmVySW5mby5JZCk7XG4gICAgYXdhaXQgY2hlY2tQb2RtYW5NYWNoaW5lU3RhdHVzKGZhbHNlKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gc2hvd1JhbWFsYW1hQ2hhdCgpIHtcbiAgICBjb25zdCBjb250YWluZXJJbmZvID0gYXdhaXQgaGFzQXBpckNvbnRhaW5lclJ1bm5pbmcoKTtcbiAgICBpZiAoY29udGFpbmVySW5mbyA9PT0gdW5kZWZpbmVkKSB7XG5cdGNvbnN0IG1zZyA9IGDwn5S0IENvdWxkIG5vdCBmaW5kIGFuIEFQSSBSZW1vdGluZyBjb250YWluZXIgcnVubmluZyAuLi5gXG5cdHNldFN0YXR1cyhtc2cpO1xuICAgICAgICBhd2FpdCBleHRlbnNpb25BcGkud2luZG93LnNob3dFcnJvck1lc3NhZ2UobXNnKTtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCBhcGlfdXJsID0gY29udGFpbmVySW5mbz8uTGFiZWxzPy5hcGk7XG5cbiAgICBpZiAoIWFwaV91cmwpIHtcblx0Y29uc3QgbXNnID0gJ/CflLQgTWlzc2luZyBBUEkgVVJMIGxhYmVsIG9uIHRoZSBydW5uaW5nIEFQSVIgY29udGFpbmVyLic7XG5cdHNldFN0YXR1cyhtc2cpO1xuXHRhd2FpdCBleHRlbnNpb25BcGkud2luZG93LnNob3dFcnJvck1lc3NhZ2UobXNnKTtcblx0cmV0dXJuO1xuICAgIH1cblxuICAgIGF3YWl0IGV4dGVuc2lvbkFwaS53aW5kb3cuc2hvd0lucHV0Qm94KHtcblx0dGl0bGU6IFwicmFtYWxhbWEgY2hhdFwiLFxuXHRwcm9tcHQ6IFwiUmFtYUxhbWEgY29tbWFuZCB0byBjaGF0IHdpdGggdGhlIEFQSSBSZW1vdGluZyBtb2RlbFwiLFxuXHRtdWx0aWxpbmU6IHRydWUsXG5cdHZhbHVlOiBgcmFtYWxhbWEgY2hhdCAtLXVybCBcIiR7YXBpX3VybH1cImAsXG4gICAgfSk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHNob3dSYW1hbGFtYVJ1bigpIHtcbiAgICBpZiAoIVJhbWFsYW1hUmVtb3RpbmdJbWFnZSkge1xuXHRhd2FpdCBleHRlbnNpb25BcGkud2luZG93LnNob3dFcnJvck1lc3NhZ2UoJ0FQSVIgaW1hZ2UgaXMgbm90IGxvYWRlZCB5ZXQuJyk7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG4gICAgYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93SW5wdXRCb3goe1xuXHR0aXRsZTogXCJyYW1hbGFtYSBydW5cIixcblx0cHJvbXB0OiBcIlJhbWFMYW1hIGNvbW1hbmQgdG8gbGF1bmNoIGEgbW9kZWxcIixcblx0bXVsdGlsaW5lOiB0cnVlLFxuXHR2YWx1ZTogYHJhbWFsYW1hIHJ1biAtLWltYWdlIFwiJHtSYW1hbGFtYVJlbW90aW5nSW1hZ2V9XCIgbGxhbWEzLjJgLFxuICAgIH0pO1xufVxuXG5hc3luYyBmdW5jdGlvbiBzaG93UmFtYWxhbWFCZW5jaG1hcmsoKSB7XG4gICAgaWYgKCFSYW1hbGFtYVJlbW90aW5nSW1hZ2UpIHtcblx0YXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93RXJyb3JNZXNzYWdlKCdBUElSIGltYWdlIGlzIG5vdCBsb2FkZWQgeWV0LicpO1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93SW5wdXRCb3goe1xuXHR0aXRsZTogXCJyYW1hbGFtYSBiZW5jaFwiLFxuXHRwcm9tcHQ6IFwiUmFtYUxhbWEgY29tbWFuZHMgdG8gcnVuIGJlbmNobWFya3NcIixcblx0bXVsdGlsaW5lOiB0cnVlLFxuXHR2YWx1ZTogYFxuIyBWZW51cy1WdWxrYW4gYmVuY2htYXJraW5nXG5yYW1hbGFtYSBiZW5jaCBsbGFtYTMuMlxuXG4jIE5hdGl2ZSBNZXRhbCBiZW5jaG1hcmtpbmcgKG5lZWRzIFxcYGxsYW1hLWJlbmNoXFxgIGluc3RhbGxlZClcbnJhbWFsYW1hIC0tbm9jb250YWluZXIgYmVuY2ggbGxhbWEzLjJcblxuIyBBUEkgUmVtb3RpbmcgYmVuY2htYXJrXG5yYW1hbGFtYSBiZW5jaCAgLS1pbWFnZSBcIiR7UmFtYWxhbWFSZW1vdGluZ0ltYWdlfVwiIGxsYW1hMy4yXG4jIChzY3JvbGwgdXAgdG8gc2VlIG1vcmUpYFxuICAgIH0pO1xufVxuXG5hc3luYyBmdW5jdGlvbiBsYXVuY2hBcGlySW5mZXJlbmNlU2VydmVyKCkge1xuICAgIGNvbnN0IGNvbnRhaW5lckluZm8gPSBhd2FpdCBoYXNBcGlyQ29udGFpbmVyUnVubmluZygpO1xuICAgIGlmIChjb250YWluZXJJbmZvICE9PSB1bmRlZmluZWQpIHtcblx0Y29uc3QgaWQgPSBjb250YWluZXJJbmZvLklkO1xuICAgICAgICBjb25zb2xlLmVycm9yKGBBUEkgUmVtb3RpbmcgY29udGFpbmVyICR7aWR9IGFscmVhZHkgcnVubmluZyAuLi5gKTtcbiAgICAgICAgYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93RXJyb3JNZXNzYWdlKGDwn5+gIEFQSSBSZW1vdGluZyBjb250YWluZXIgJHtpZH0gaXMgYWxyZWFkeSBydW5uaW5nLiBUaGlzIHZlcnNpb24gY2Fubm90IGhhdmUgdHdvIEFQSSBSZW1vdGluZyBjb250YWluZXJzIHJ1bm5pbmcgc2ltdWx0YW5lb3VzbHkuYCk7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAoUmFtYWxhbWFSZW1vdGluZ0ltYWdlID09PSB1bmRlZmluZWQpIHRocm93IG5ldyBFcnJvcihcIlJhbWFsYW1hIFJlbW90aW5nIGltYWdlIG5hbWUgbm90IGxvYWRlZC4gVGhpcyBpcyB1bmV4cGVjdGVkLlwiKTtcblxuICAgIHNldFN0YXR1cyhcIuKame+4jyBDb25maWd1cmluZyB0aGUgaW5mZXJlbmNlIHNlcnZlciAuLi5cIilcbiAgICBsZXQgbW9kZWxfbmFtZTtcbiAgICBpZiAoT2JqZWN0LmtleXMoQXZhaWxhYmxlTW9kZWxzKS5sZW5ndGggPT09IDApIHtcblx0aWYgKCFOb0FpTGFiTW9kZWxXYXJuaW5nU2hvd24pIHtcblx0ICAgIGF3YWl0IGV4dGVuc2lvbkFwaS53aW5kb3cuc2hvd0luZm9ybWF0aW9uTWVzc2FnZShg8J+foCBDb3VsZCBub3QgZmluZCBhbnkgbW9kZWwgZG93bmxvYWRlZCBmcm9tIEFJIExhYi4gUGxlYXNlIHNlbGVjdCBhIEdHVUYgZmlsZSB0byBsb2FkLmApO1xuXHQgICAgTm9BaUxhYk1vZGVsV2FybmluZ1Nob3duID0gdHJ1ZTtcblx0fVxuXHRsZXQgdXJpcyA9IGF3YWl0IGV4dGVuc2lvbkFwaS53aW5kb3cuc2hvd09wZW5EaWFsb2coe1xuXHQgICAgdGl0bGU6IFwiU2VsZWN0IGEgR0dVRiBtb2RlbCBmaWxlXCIsXG5cdCAgICBvcGVuTGFiZWw6IFwiU2VsZWN0XCIsXG5cdCAgICBjYW5TZWxlY3RGaWxlczogdHJ1ZSxcblx0ICAgIGNhblNlbGVjdEZvbGRlcnM6IGZhbHNlLFxuXHQgICAgY2FuU2VsZWN0TWFueTogZmFsc2UsXG5cdCAgICBmaWx0ZXJzOiB7ICdHR1VGIE1vZGVscyc6IFsnZ2d1ZiddIH0sXG5cdH0pXG5cblx0aWYgKCF1cmlzIHx8IHVyaXMubGVuZ3RoID09PSAwKSB7XG5cdCAgICBjb25zb2xlLmxvZyhcIk5vIG1vZGVsIHNlbGVjdGVkLCBhYm9ydGluZyB0aGUgQVBJUiBjb250YWluZXIgbGF1bmNoIHNpbGVudGx5LlwiKVxuXHQgICAgcmV0dXJuO1xuXHR9XG5cdG1vZGVsX25hbWUgPSB1cmlzWzBdLmZzUGF0aDtcblxuXHRpZiAoUkVTVFJJQ1RfT1BFTl9UT19HR1VGX0ZJTEVTKSB7XG5cdCAgICBpZiAocGF0aC5leHRuYW1lKG1vZGVsX25hbWUpLnRvTG93ZXJDYXNlKCkgIT09ICcuZ2d1ZicpIHtcblx0XHRjb25zdCBtc2cgPSBgU2VsZWN0ZWQgZmlsZSBpc24ndCBhIC5nZ3VmOiAke21vZGVsX25hbWV9YFxuXHRcdGNvbnNvbGUud2Fybihtc2cpO1xuXHRcdGF3YWl0IGV4dGVuc2lvbkFwaS53aW5kb3cuc2hvd0Vycm9yTWVzc2FnZShtc2cpO1xuXHRcdHJldHVybjtcblx0ICAgIH1cblx0fVxuXG5cdGlmICghZnMuZXhpc3RzU3luYyhtb2RlbF9uYW1lKSl7XG4gICAgICAgICAgICBjb25zdCBtc2cgPSBgU2VsZWN0ZWQgR0dVRiBtb2RlbCBmaWxlIGRvZXMgbm90IGV4aXN0OiAke21vZGVsX25hbWV9YFxuICAgICAgICAgICAgY29uc29sZS53YXJuKG1zZyk7XG4gICAgICAgICAgICBhd2FpdCBleHRlbnNpb25BcGkud2luZG93LnNob3dFcnJvck1lc3NhZ2UobXNnKTtcblx0ICAgIHJldHVybjtcblx0fVxuXG5cbiAgICB9IGVsc2Uge1xuICAgICAgICByZWZyZXNoQXZhaWxhYmxlTW9kZWxzKCk7XG5cbiAgICAgICAgLy8gZGlzcGxheSBhIGNob2ljZSB0byB0aGUgdXNlciBmb3Igc2VsZWN0aW5nIHNvbWUgdmFsdWVzXG4gICAgICAgIG1vZGVsX25hbWUgPSBhd2FpdCBleHRlbnNpb25BcGkud2luZG93LnNob3dRdWlja1BpY2soT2JqZWN0LmtleXMoQXZhaWxhYmxlTW9kZWxzKSwge1xuICAgICAgICAgICAgY2FuUGlja01hbnk6IGZhbHNlLCAvLyB1c2VyIGNhbiBzZWxlY3QgbW9yZSB0aGFuIG9uZSBjaG9pY2VcbiAgICAgICAgICAgIHRpdGxlOiBcIkNob29zZSB0aGUgbW9kZWwgdG8gZGVwbG95XCIsXG4gICAgICAgIH0pO1xuICAgICAgICBpZiAobW9kZWxfbmFtZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBjb25zb2xlLndhcm4oJ05vIG1vZGVsIGNob3Nlbiwgbm90aGluZyB0byBsYXVuY2guJylcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIHByZXBhcmUgdGhlIHBvcnRcblxuICAgIGNvbnN0IGhvc3RfcG9ydF9zdHIgPSBhd2FpdCBleHRlbnNpb25BcGkud2luZG93LnNob3dJbnB1dEJveCh7XG5cdHRpdGxlOiBcIlNlcnZpY2UgcG9ydFwiLFxuXHRwcm9tcHQ6IFwiSW5mZXJlbmNlIHNlcnZpY2UgcG9ydCBvbiB0aGUgaG9zdFwiLFxuXHR2YWx1ZTogXCIxMjM0XCIsXG5cdHZhbGlkYXRlSW5wdXQ6ICh2YWx1ZSkgPT4gKHBhcnNlSW50KHZhbHVlLCAxMCkgPiAxMDI0ID8gXCJcIiA6IFwiRW50ZXIgYSB2YWxpZCBwb3J0ID4gMTAyNFwiKSxcbiAgICB9KTtcbiAgICBjb25zdCBob3N0X3BvcnQgPSBob3N0X3BvcnRfc3RyID8gcGFyc2VJbnQoaG9zdF9wb3J0X3N0ciwgMTApIDogTnVtYmVyLk5hTjtcblxuICAgIGlmIChOdW1iZXIuaXNOYU4oaG9zdF9wb3J0KSkge1xuICAgICAgICBjb25zb2xlLndhcm4oJ05vIGhvc3QgcG9ydCBjaG9zZW4sIG5vdGhpbmcgdG8gbGF1bmNoLicpXG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBzZXRTdGF0dXMoXCLimpnvuI8gUHVsbGluZyB0aGUgaW1hZ2UgLi4uXCIpXG4gICAgLy8gcHVsbCB0aGUgaW1hZ2VcbiAgICBjb25zdCBpbWFnZUluZm86IEltYWdlSW5mbyA9IGF3YWl0IHB1bGxJbWFnZShcbiAgICAgICAgUmFtYWxhbWFSZW1vdGluZ0ltYWdlLFxuICAgICAgICB7fSxcbiAgICApO1xuXG4gICAgc2V0U3RhdHVzKFwi4pqZ77iPIENyZWF0aW5nIHRoZSBjb250YWluZXIgLi4uXCIpXG4gICAgLy8gZ2V0IG1vZGVsIG1vdW50IHNldHRpbmdzXG4gICAgY29uc3QgbW9kZWxfc3JjOiBzdHJpbmcgPSBBdmFpbGFibGVNb2RlbHNbbW9kZWxfbmFtZV0gPz8gbW9kZWxfbmFtZTtcblxuICAgIGlmIChtb2RlbF9zcmMgPT09IHVuZGVmaW5lZClcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBDb3VsZG4ndCBnZXQgdGhlIGZpbGUgYXNzb2NpYXRlZCB3aXRoIG1vZGVsICR7bW9kZWxfc3JjfS4gVGhpcyBpcyB1bmV4cGVjdGVkLmApO1xuXG4gICAgY29uc3QgbW9kZWxfZmlsZW5hbWUgPSBwYXRoLmJhc2VuYW1lKG1vZGVsX3NyYyk7XG4gICAgY29uc3QgbW9kZWxfZGlybmFtZSA9IHBhdGguYmFzZW5hbWUocGF0aC5kaXJuYW1lKG1vZGVsX3NyYykpO1xuICAgIGNvbnN0IG1vZGVsX2Rlc3QgPSBgL21vZGVscy8ke21vZGVsX2ZpbGVuYW1lfWA7XG4gICAgY29uc3QgYWlfbGFiX3BvcnQgPSAxMDQzNDtcblxuICAgIC8vIHByZXBhcmUgdGhlIGxhYmVsc1xuICAgIGNvbnN0IGxhYmVsczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHtcbiAgICAgICAgWydhaS1sYWItaW5mZXJlbmNlLXNlcnZlciddOiBKU09OLnN0cmluZ2lmeShbbW9kZWxfZGlybmFtZV0pLFxuICAgICAgICBbJ2FwaSddOiBgaHR0cDovLzEyNy4wLjAuMToke2hvc3RfcG9ydH0vdjFgLFxuICAgICAgICBbJ2RvY3MnXTogYGh0dHA6Ly8xMjcuMC4wLjE6JHthaV9sYWJfcG9ydH0vYXBpLWRvY3MvJHtob3N0X3BvcnR9YCxcbiAgICAgICAgWydncHUnXTogYGxsYW1hLmNwcCBBUEkgUmVtb3RpbmdgLFxuICAgICAgICBbXCJ0cmFja2luZ0lkXCJdOiBnZXRSYW5kb21TdHJpbmcoKSxcbiAgICAgICAgW1wibGxhbWEtY3BwLmFwaXJcIl06IFwidHJ1ZVwiLFxuICAgIH07XG5cbiAgICAvLyBwcmVwYXJlIHRoZSBtb3VudHNcbiAgICAvLyBtb3VudCB0aGUgZmlsZSBkaXJlY3RvcnkgdG8gYXZvaWQgYWRkaW5nIG90aGVyIGZpbGVzIHRvIHRoZSBjb250YWluZXJzXG4gICAgY29uc3QgbW91bnRzOiBNb3VudENvbmZpZyA9IFtcbiAgICAgIHtcbiAgICAgICAgICBUYXJnZXQ6IG1vZGVsX2Rlc3QsXG4gICAgICAgICAgU291cmNlOiBtb2RlbF9zcmMsXG4gICAgICAgICAgVHlwZTogJ2JpbmQnLFxuXHQgIFJlYWRPbmx5OiB0cnVlLFxuICAgICAgfSxcbiAgICBdO1xuXG4gICAgLy8gcHJlcGFyZSB0aGUgZW50cnlwb2ludFxuICAgIGxldCBlbnRyeXBvaW50OiBzdHJpbmcgfCB1bmRlZmluZWQgPSB1bmRlZmluZWQ7XG4gICAgbGV0IGNtZDogc3RyaW5nW10gPSBbXTtcblxuICAgIGVudHJ5cG9pbnQgPSBcIi91c3IvYmluL2xsYW1hLXNlcnZlci5zaFwiO1xuXG4gICAgLy8gcHJlcGFyZSB0aGUgZW52XG4gICAgY29uc3QgZW52czogc3RyaW5nW10gPSBbYE1PREVMX1BBVEg9JHttb2RlbF9kZXN0fWAsICdIT1NUPTAuMC4wLjAnLCAnUE9SVD04MDAwJywgJ0dQVV9MQVlFUlM9OTk5J107XG5cbiAgICAvLyBwcmVwYXJlIHRoZSBkZXZpY2VzXG4gICAgY29uc3QgZGV2aWNlczogRGV2aWNlW10gPSBbXTtcbiAgICBkZXZpY2VzLnB1c2goe1xuICAgICAgICBQYXRoT25Ib3N0OiAnL2Rldi9kcmknLFxuICAgICAgICBQYXRoSW5Db250YWluZXI6ICcvZGV2L2RyaScsXG4gICAgICAgIENncm91cFBlcm1pc3Npb25zOiAnJyxcbiAgICB9KTtcblxuICAgIGNvbnN0IGRldmljZVJlcXVlc3RzOiBEZXZpY2VSZXF1ZXN0W10gPSBbXTtcbiAgICBkZXZpY2VSZXF1ZXN0cy5wdXNoKHtcbiAgICAgICAgQ2FwYWJpbGl0aWVzOiBbWydncHUnXV0sXG4gICAgICAgIENvdW50OiAtMSwgLy8gLTE6IGFsbFxuICAgIH0pO1xuXG4gICAgLy8gR2V0IHRoZSBjb250YWluZXIgY3JlYXRpb24gb3B0aW9uc1xuICAgIGNvbnN0IGNvbnRhaW5lckNyZWF0ZU9wdGlvbnM6IENvbnRhaW5lckNyZWF0ZU9wdGlvbnMgPSB7XG4gICAgICAgIEltYWdlOiBpbWFnZUluZm8uSWQsXG4gICAgICAgIERldGFjaDogdHJ1ZSxcbiAgICAgICAgRW50cnlwb2ludDogZW50cnlwb2ludCxcbiAgICAgICAgQ21kOiBjbWQsXG4gICAgICAgIEV4cG9zZWRQb3J0czogeyBbYCR7aG9zdF9wb3J0fS90Y3BgXToge30gfSxcbiAgICAgICAgSG9zdENvbmZpZzoge1xuICAgICAgICAgICAgQXV0b1JlbW92ZTogZmFsc2UsXG4gICAgICAgICAgICBEZXZpY2VzOiBkZXZpY2VzLFxuICAgICAgICAgICAgTW91bnRzOiBtb3VudHMsXG4gICAgICAgICAgICBEZXZpY2VSZXF1ZXN0czogZGV2aWNlUmVxdWVzdHMsXG4gICAgICAgICAgICBTZWN1cml0eU9wdDogW1wibGFiZWw9ZGlzYWJsZVwiXSxcbiAgICAgICAgICAgIFBvcnRCaW5kaW5nczoge1xuICAgICAgICAgICAgICAgICc4MDAwL3RjcCc6IFtcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgSG9zdFBvcnQ6IGAke2hvc3RfcG9ydH1gLFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICB9LFxuICAgICAgICB9LFxuXG4gICAgICAgIEhlYWx0aENoZWNrOiB7XG4gICAgICAgICAgLy8gbXVzdCBiZSB0aGUgcG9ydCBJTlNJREUgdGhlIGNvbnRhaW5lciBub3QgdGhlIGV4cG9zZWQgb25lXG4gICAgICAgICAgVGVzdDogWydDTUQtU0hFTEwnLCBgY3VybCAtc1NmIGxvY2FsaG9zdDo4MDAwID4gL2Rldi9udWxsYF0sXG4gICAgICAgICAgSW50ZXJ2YWw6IFNFQ09ORCAqIDUsXG4gICAgICAgICAgUmV0cmllczogNCAqIDUsXG4gICAgICAgICAgfSxcbiAgICAgICAgTGFiZWxzOiBsYWJlbHMsXG4gICAgICAgIEVudjogZW52cyxcbiAgICB9O1xuICAgIGNvbnNvbGUubG9nKGNvbnRhaW5lckNyZWF0ZU9wdGlvbnMsIG1vdW50cylcbiAgICAvLyBDcmVhdGUgdGhlIGNvbnRhaW5lclxuICAgIGNvbnN0IHsgZW5naW5lSWQsIGlkIH0gPSBhd2FpdCBjcmVhdGVDb250YWluZXIoaW1hZ2VJbmZvLmVuZ2luZUlkLCBjb250YWluZXJDcmVhdGVPcHRpb25zLCBsYWJlbHMpO1xuICAgIHNldFN0YXR1cyhg8J+OiSBJbmZlcmVuY2Ugc2VydmVyIGlzIHJlYWR5IG9uIHBvcnQgJHtob3N0X3BvcnR9YClcbiAgICBhd2FpdCBleHRlbnNpb25BcGkud2luZG93LnNob3dJbmZvcm1hdGlvbk1lc3NhZ2UoYPCfjokgJHttb2RlbF9uYW1lfSBpcyBydW5uaW5nIHdpdGggQVBJIFJlbW90aW5nIGFjY2VsZXJhdGlvbiFgKTtcblxufVxuZXhwb3J0IHR5cGUgQmV0dGVyQ29udGFpbmVyQ3JlYXRlUmVzdWx0ID0gQ29udGFpbmVyQ3JlYXRlUmVzdWx0ICYgeyBlbmdpbmVJZDogc3RyaW5nIH07XG5cbmFzeW5jIGZ1bmN0aW9uIGNyZWF0ZUNvbnRhaW5lcihcbiAgICBlbmdpbmVJZDogc3RyaW5nLFxuICAgIGNvbnRhaW5lckNyZWF0ZU9wdGlvbnM6IENvbnRhaW5lckNyZWF0ZU9wdGlvbnMsXG4gICAgbGFiZWxzOiB7IFtpZDogc3RyaW5nXTogc3RyaW5nIH0sXG4pOiBQcm9taXNlPEJldHRlckNvbnRhaW5lckNyZWF0ZVJlc3VsdD4ge1xuXG4gICAgY29uc29sZS5sb2coXCJDcmVhdGluZyBjb250YWluZXIgLi4uXCIpO1xuICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGNvbnRhaW5lckVuZ2luZS5jcmVhdGVDb250YWluZXIoZW5naW5lSWQsIGNvbnRhaW5lckNyZWF0ZU9wdGlvbnMpO1xuICAgICAgICBjb25zb2xlLmxvZyhcIkNvbnRhaW5lciBjcmVhdGVkIVwiKTtcblxuICAgICAgICAvLyByZXR1cm4gdGhlIENvbnRhaW5lckNyZWF0ZVJlc3VsdFxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgaWQ6IHJlc3VsdC5pZCxcbiAgICAgICAgICAgIGVuZ2luZUlkOiBlbmdpbmVJZCxcbiAgICAgICAgfTtcbiAgICB9IGNhdGNoIChlcnI6IHVua25vd24pIHtcbiAgICAgICAgY29uc3QgbXNnID0gYENvbnRhaW5lciBjcmVhdGlvbiBmYWlsZWQgOi8gJHtTdHJpbmcoZXJyKX1gXG4gICAgICAgIGNvbnNvbGUuZXJyb3IobXNnKTtcblx0c2V0U3RhdHVzKFwi8J+UtCBDb250YWluZXIgY3JlYXRpb24gZmFpbGVkXCIpXG4gICAgICAgIGF3YWl0IGV4dGVuc2lvbkFwaS53aW5kb3cuc2hvd0Vycm9yTWVzc2FnZShtc2cpO1xuICAgICAgICB0aHJvdyBlcnI7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBnZXRDb25uZWN0aW9uKGFsbG93VW5kZWZpbmVkID0gZmFsc2UpOiBDb250YWluZXJQcm92aWRlckNvbm5lY3Rpb24gfCB1bmRlZmluZWQge1xuICAgIGNvbnN0IHByb3ZpZGVyczogUHJvdmlkZXJDb250YWluZXJDb25uZWN0aW9uW10gPSBwcm92aWRlci5nZXRDb250YWluZXJDb25uZWN0aW9ucygpO1xuICAgIGNvbnN0IHBvZG1hblByb3ZpZGVyID0gcHJvdmlkZXJzLmZpbmQoKHsgY29ubmVjdGlvbiB9KSA9PiBjb25uZWN0aW9uLnR5cGUgPT09ICdwb2RtYW4nICYmIGNvbm5lY3Rpb24uc3RhdHVzKCkgPT09IFwic3RhcnRlZFwiKTtcbiAgICBpZiAoIXBvZG1hblByb3ZpZGVyKSB7XG5cdGlmIChhbGxvd1VuZGVmaW5lZCkge1xuXHQgICAgcmV0dXJuIHVuZGVmaW5lZDtcblx0fSBlbHNlIHtcblx0ICAgIHRocm93IG5ldyBFcnJvcignY2Fubm90IGZpbmQgcG9kbWFuIHByb3ZpZGVyJyk7XG5cdH1cbiAgICB9XG4gICAgbGV0IGNvbm5lY3Rpb246IENvbnRhaW5lclByb3ZpZGVyQ29ubmVjdGlvbiA9IHBvZG1hblByb3ZpZGVyLmNvbm5lY3Rpb247XG5cbiAgICByZXR1cm4gY29ubmVjdGlvbjtcbn1cblxuYXN5bmMgZnVuY3Rpb24gcHVsbEltYWdlKFxuICAgIGltYWdlOiBzdHJpbmcsXG4gICAgbGFiZWxzOiB7IFtpZDogc3RyaW5nXTogc3RyaW5nIH0sXG4pOiBQcm9taXNlPEltYWdlSW5mbz4ge1xuICAgIC8vIENyZWF0aW5nIGEgdGFzayB0byBmb2xsb3cgcHVsbGluZyBwcm9ncmVzc1xuICAgIGNvbnNvbGUubG9nKGBQdWxsaW5nIHRoZSBpbWFnZSAke2ltYWdlfSAuLi5gKVxuICAgIGNvbnN0IGNvbm5lY3Rpb24gPSBnZXRDb25uZWN0aW9uKCk7XG5cbiAgICAvLyBnZXQgdGhlIGRlZmF1bHQgaW1hZ2UgaW5mbyBmb3IgdGhpcyBwcm92aWRlclxuICAgIHJldHVybiBnZXRJbWFnZUluZm8oY29ubmVjdGlvbiwgaW1hZ2UsIChfZXZlbnQ6IFB1bGxFdmVudCkgPT4ge30pXG4gICAgICAgIC5jYXRjaCgoZXJyOiB1bmtub3duKSA9PiB7XG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKGBTb21ldGhpbmcgd2VudCB3cm9uZyB3aGlsZSBwdWxsaW5nICR7aW1hZ2V9OiAke1N0cmluZyhlcnIpfWApO1xuICAgICAgICAgICAgdGhyb3cgZXJyO1xuICAgICAgICB9KVxuICAgICAgICAudGhlbihpbWFnZUluZm8gPT4ge1xuICAgICAgICAgICAgY29uc29sZS5sb2coXCJJbWFnZSBwdWxsZWQgc3VjY2Vzc2Z1bGx5XCIpO1xuICAgICAgICAgICAgcmV0dXJuIGltYWdlSW5mbztcbiAgICAgICAgfSk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGdldEltYWdlSW5mbyhcbiAgY29ubmVjdGlvbjogQ29udGFpbmVyUHJvdmlkZXJDb25uZWN0aW9uLFxuICBpbWFnZTogc3RyaW5nLFxuICBjYWxsYmFjazogKGV2ZW50OiBQdWxsRXZlbnQpID0+IHZvaWQsXG4pOiBQcm9taXNlPEltYWdlSW5mbz4ge1xuICAgIGxldCBpbWFnZUluZm8gPSB1bmRlZmluZWQ7XG5cbiAgICB0cnkge1xuICAgICAgICAvLyBQdWxsIGltYWdlXG4gICAgICAgIGF3YWl0IGNvbnRhaW5lckVuZ2luZS5wdWxsSW1hZ2UoY29ubmVjdGlvbiwgaW1hZ2UsIGNhbGxiYWNrKTtcblxuICAgICAgICAvLyBHZXQgaW1hZ2UgaW5zcGVjdFxuICAgICAgICBpbWFnZUluZm8gPSAoXG4gICAgICAgICAgICBhd2FpdCBjb250YWluZXJFbmdpbmUubGlzdEltYWdlcyh7XG4gICAgICAgICAgICAgICAgcHJvdmlkZXI6IGNvbm5lY3Rpb24sXG4gICAgICAgICAgICB9IGFzIExpc3RJbWFnZXNPcHRpb25zKVxuICAgICAgICApLmZpbmQoaW1hZ2VJbmZvID0+IGltYWdlSW5mby5SZXBvVGFncz8uc29tZSh0YWcgPT4gdGFnID09PSBpbWFnZSkpO1xuXG4gICAgfSBjYXRjaCAoZXJyOiB1bmtub3duKSB7XG4gICAgICAgIGNvbnNvbGUud2FybignU29tZXRoaW5nIHdlbnQgd3Jvbmcgd2hpbGUgdHJ5aW5nIHRvIGdldCBpbWFnZSBpbnNwZWN0JywgZXJyKTtcbiAgICAgICAgYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93RXJyb3JNZXNzYWdlKGBTb21ldGhpbmcgd2VudCB3cm9uZyB3aGlsZSB0cnlpbmcgdG8gZ2V0IGltYWdlIGluc3BlY3Q6ICR7ZXJyfWApO1xuXG4gICAgICAgIHRocm93IGVycjtcbiAgICB9XG5cbiAgICBpZiAoaW1hZ2VJbmZvID09PSB1bmRlZmluZWQpIHRocm93IG5ldyBFcnJvcihgaW1hZ2UgJHtpbWFnZX0gbm90IGZvdW5kLmApO1xuXG4gICAgcmV0dXJuIGltYWdlSW5mbztcbn1cblxuYXN5bmMgZnVuY3Rpb24gaW5pdGlhbGl6ZUJ1aWxkRGlyKGJ1aWxkUGF0aCkge1xuICAgIGNvbnNvbGUubG9nKGBJbml0aWFsaXppbmcgdGhlIGJ1aWxkIGRpcmVjdG9yeSBmcm9tICR7YnVpbGRQYXRofSAuLi5gKVxuXG4gICAgQXBpclZlcnNpb24gPSAoYXdhaXQgYXN5bmNfZnMucmVhZEZpbGUoYnVpbGRQYXRoICsgJy9zcmNfaW5mby92ZXJzaW9uLnR4dCcsICd1dGY4JykpLnJlcGxhY2UoL1xcbiQvLCBcIlwiKTtcblxuICAgIGlmIChSYW1hbGFtYVJlbW90aW5nSW1hZ2UgPT09IHVuZGVmaW5lZClcbiAgICAgICAgUmFtYWxhbWFSZW1vdGluZ0ltYWdlID0gKGF3YWl0IGFzeW5jX2ZzLnJlYWRGaWxlKGJ1aWxkUGF0aCArICcvc3JjX2luZm8vcmFtYWxhbWEuaW1hZ2UtaW5mby50eHQnLCAndXRmOCcpKS5yZXBsYWNlKC9cXG4kLywgXCJcIik7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGluaXRpYWxpemVTdG9yYWdlRGlyKHN0b3JhZ2VQYXRoLCBidWlsZFBhdGgpIHtcbiAgICBjb25zb2xlLmxvZyhgSW5pdGlhbGl6aW5nIHRoZSBzdG9yYWdlIGRpcmVjdG9yeSAuLi5gKVxuXG4gICAgaWYgKCFmcy5leGlzdHNTeW5jKHN0b3JhZ2VQYXRoKSl7XG4gICAgICAgIGZzLm1rZGlyU3luYyhzdG9yYWdlUGF0aCk7XG4gICAgfVxuXG4gICAgaWYgKEFwaXJWZXJzaW9uID09PSB1bmRlZmluZWQpIHRocm93IG5ldyBFcnJvcihcIkFQSVIgdmVyc2lvbiBub3QgbG9hZGVkLiBUaGlzIGlzIHVuZXhwZWN0ZWQuXCIpO1xuXG4gICAgTG9jYWxCdWlsZERpciA9IGAke3N0b3JhZ2VQYXRofS8ke0FwaXJWZXJzaW9ufWA7XG4gICAgaWYgKCFmcy5leGlzdHNTeW5jKExvY2FsQnVpbGREaXIpKXtcbiAgICAgICAgYXdhaXQgY29weVJlY3Vyc2l2ZShidWlsZFBhdGgsIExvY2FsQnVpbGREaXIpXG4gICAgICAgIGNvbnNvbGUubG9nKCdDb3B5IGNvbXBsZXRlJyk7XG4gICAgfVxufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gYWN0aXZhdGUoZXh0ZW5zaW9uQ29udGV4dDogZXh0ZW5zaW9uQXBpLkV4dGVuc2lvbkNvbnRleHQpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAvLyBpbml0aWFsaXplIHRoZSBnbG9iYWwgdmFyaWFibGVzIC4uLlxuICAgIEV4dGVuc2lvblN0b3JhZ2VQYXRoID0gZXh0ZW5zaW9uQ29udGV4dC5zdG9yYWdlUGF0aDtcbiAgICBjb25zb2xlLmxvZyhcIkFjdGl2YXRpbmcgdGhlIEFQSSBSZW1vdGluZyBleHRlbnNpb24gLi4uXCIpXG5cbiAgIC8vIHJlZ2lzdGVyIHRoZSBjb21tYW5kIHJlZmVyZW5jZWQgaW4gcGFja2FnZS5qc29uIGZpbGVcbiAgICBjb25zdCBtZW51Q29tbWFuZCA9IGV4dGVuc2lvbkFwaS5jb21tYW5kcy5yZWdpc3RlckNvbW1hbmQoJ2xsYW1hLmNwcC5hcGlyLm1lbnUnLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGlmIChGQUlMX0lGX05PVF9NQUMgJiYgIWV4dGVuc2lvbkFwaS5lbnYuaXNNYWMpIHtcbiAgICAgICAgICAgIGF3YWl0IGV4dGVuc2lvbkFwaS53aW5kb3cuc2hvd0Vycm9yTWVzc2FnZShgbGxhbWEuY3BwIEFQSSBSZW1vdGluZyBvbmx5IHN1cHBvcnRlZCBvbiBNYWNPUy5gKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG5cdGxldCBzdGF0dXMgPSBcIihzdGF0dXMgaXMgdW5kZWZpbmVkKVwiO1xuXHR0cnkge1xuXHQgICAgc3RhdHVzID0gYXdhaXQgY2hlY2tQb2RtYW5NYWNoaW5lU3RhdHVzKGZhbHNlKVxuXHR9IGNhdGNoIChlcnI6IHVua25vd24pIHtcblx0ICAgIGF3YWl0IGV4dGVuc2lvbkFwaS53aW5kb3cuc2hvd0Vycm9yTWVzc2FnZShlcnIpO1xuXHQgICAgcmV0dXJuO1xuXHR9XG5cblx0Y29uc3QgbWFpbl9tZW51X2Nob2ljZXM6IFJlY29yZDxzdHJpbmcsICgpID0+IFByb21pc2U8dm9pZD4gfCB2b2lkPiA9IHt9O1xuXHQvLyBzdGF0dXMgdmFsdWVzOlxuXG5cdC8vICAwID09PiBydW5uaW5nIHdpdGggQVBJIFJlbW90aW5nIHN1cHBvcnRcblx0Ly8gMTAgPT0+IHJ1bm5pbmcgdmZraXQgVk0gaW5zdGVhZCBvZiBrcnVua2l0XG5cdC8vIDExID09PiBrcnVua2l0IG5vdCBydW5uaW5nXG5cdC8vIDEyID09PiBrcnVua2l0IHJ1bm5pbmcgd2l0aG91dCBBUEkgUmVtb3Rpbmdcblx0Ly8gMnggPT0+IHNjcmlwdCBjYW5ub3QgcnVuIGNvcnJlY3RseVxuXG5cdC8vICAxID09PiBydW5uaW5nIHdpdGggYSBjb250YWluZXIgbGF1bmNoZWRcblx0Ly8xMjcgPT0+IEFQSVIgZmlsZXMgbm90IGF2YWlsYWJsZVxuXG5cdGxldCBzdGF0dXNfc3RyO1xuXHRpZiAoc3RhdHVzID09PSAxMjcpIHsgLy8gZmlsZXMgaGF2ZSBiZWVuIHVuaW5zdGFsbGVkXG5cdCAgICBzdGF0dXNfc3RyID0gXCJBUEkgUmVtb3RpbmcgYmluYXJpZXMgYXJlIG5vdCBpbnN0YWxsZWRcIlxuXHQgICAgbWFpbl9tZW51X2Nob2ljZXNbXCJSZWluc3RhbGwgdGhlIEFQSSBSZW1vdGluZyBiaW5hcmllc1wiXSA9IGluc3RhbGxBcGlyQmluYXJpZXM7XG5cblx0fSBlbHNlIGlmIChzdGF0dXMgPT09IDAgfHwgc3RhdHVzID09PSAxKSB7IC8vIHJ1bm5pbmcgd2l0aCBBUEkgUmVtb3Rpbmcgc3VwcG9ydFxuXHQgICAgaWYgKHN0YXR1cyA9PT0gMCkge1xuXHRcdHN0YXR1c19zdHIgPSBcIlZNIGlzIHJ1bm5pbmcgd2l0aCBBUEkgUmVtb3Rpbmcg8J+OiVwiXG5cdFx0bWFpbl9tZW51X2Nob2ljZXNbXCJMYXVuY2ggYW4gQVBJIFJlbW90aW5nIGFjY2VsZXJhdGVkIEluZmVyZW5jZSBTZXJ2ZXJcIl0gPSBsYXVuY2hBcGlySW5mZXJlbmNlU2VydmVyO1xuXHRcdG1haW5fbWVudV9jaG9pY2VzW1wiU2hvdyBSYW1hTGFtYSBtb2RlbCBsYXVuY2ggY29tbWFuZFwiXSA9IHNob3dSYW1hbGFtYVJ1bjtcblx0XHRtYWluX21lbnVfY2hvaWNlc1tcIlNob3cgUmFtYUxhbWEgYmVuY2htYXJrIGNvbW1hbmRzXCJdID0gc2hvd1JhbWFsYW1hQmVuY2htYXJrO1xuXHQgICAgfSBlbHNlIHtcblx0XHRzdGF0dXNfc3RyID0gXCJhbiBBUEkgUmVtb3RpbmcgaW5mZXJlbmNlIHNlcnZlciBpcyBhbHJlYWR5IHJ1bm5pbmdcIlxuXHRcdG1haW5fbWVudV9jaG9pY2VzW1wiU2hvdyBSYW1hTGFtYSBjaGF0IGNvbW1hbmRcIl0gPSBzaG93UmFtYWxhbWFDaGF0O1xuXHRcdG1haW5fbWVudV9jaG9pY2VzW1wiU3RvcCB0aGUgQVBJIFJlbW90aW5nIEluZmVyZW5jZSBTZXJ2ZXJcIl0gPSBzdG9wQXBpckluZmVyZW5jZVNlcnZlcjtcblx0ICAgIH1cblx0ICAgIG1haW5fbWVudV9jaG9pY2VzW1wiLS0tXCJdID0gZnVuY3Rpb24oKSB7fTtcblx0ICAgIG1haW5fbWVudV9jaG9pY2VzW1wiUmVzdGFydCBQb2RNYW4gTWFjaGluZSB3aXRob3V0IEFQSSBSZW1vdGluZ1wiXSA9IHJlc3RhcnRfcG9kbWFuX21hY2hpbmVfd2l0aG91dF9hcGlyO1xuXG5cdH0gZWxzZSBpZiAoc3RhdHVzID09PSAxMCB8fCBzdGF0dXMgPT09IDExIHx8IHN0YXR1cyA9PT0gMTIpIHtcblx0ICAgIGlmIChzdGF0dXMgPT09IDEwKSB7XG5cdFx0c3RhdHVzX3N0ciA9IFwiVk0gaXMgcnVubmluZyB3aXRoIHZma2l0XCI7XG5cdCAgICB9IGVsc2UgaWYgKHN0YXR1cyA9PT0gMTEpIHtcblx0XHRzdGF0dXNfc3RyID0gXCJWTSBpcyBub3QgcnVubmluZ1wiO1xuXHQgICAgfSBlbHNlIGlmIChzdGF0dXMgPT09IDEyKSB7XG5cdFx0c3RhdHVzX3N0ciA9IFwiVk0gaXMgcnVubmluZyB3aXRob3V0IEFQSSBSZW1vdGluZ1wiO1xuXHQgICAgfVxuXHQgICAgbWFpbl9tZW51X2Nob2ljZXNbXCJSZXN0YXJ0IFBvZE1hbiBNYWNoaW5lIHdpdGggQVBJIFJlbW90aW5nIHN1cHBvcnRcIl0gPSByZXN0YXJ0X3BvZG1hbl9tYWNoaW5lX3dpdGhfYXBpcjtcblx0ICAgIG1haW5fbWVudV9jaG9pY2VzW1wiVW5pbnN0YWxsIHRoZSBBUEkgUmVtb3RpbmcgYmluYXJpZXNcIl0gPSB1bmluc3RhbGxBcGlyQmluYXJpZXM7XG5cdH1cblxuXHRtYWluX21lbnVfY2hvaWNlc1tcIi0tLVwiXSA9IGZ1bmN0aW9uKCkge307XG5cdG1haW5fbWVudV9jaG9pY2VzW1wiQ2hlY2sgUG9kTWFuIE1hY2hpbmUgQVBJIFJlbW90aW5nIHN0YXR1c1wiXSA9ICgpID0+IGNoZWNrUG9kbWFuTWFjaGluZVN0YXR1cyh0cnVlKTtcblxuICAgICAgICAvLyBkaXNwbGF5IGEgY2hvaWNlIHRvIHRoZSB1c2VyIGZvciBzZWxlY3Rpbmcgc29tZSB2YWx1ZXNcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93UXVpY2tQaWNrKE9iamVjdC5rZXlzKG1haW5fbWVudV9jaG9pY2VzKSwge1xuICAgICAgICAgICAgdGl0bGU6IGBXaGF0IGRvXG55b3Ugd2FudCB0byBkbz8gKCR7c3RhdHVzX3N0cn0pYCxcbiAgICAgICAgICAgIGNhblBpY2tNYW55OiBmYWxzZSwgLy8gdXNlciBjYW4gc2VsZWN0IG1vcmUgdGhhbiBvbmUgY2hvaWNlXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGlmIChyZXN1bHQgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgY29uc29sZS5sb2coXCJObyB1c2VyIGNob2ljZSwgYWJvcnRpbmcuXCIpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGF3YWl0IG1haW5fbWVudV9jaG9pY2VzW3Jlc3VsdF0oKTtcbiAgICAgICAgfSBjYXRjaCAoZXJyOiB1bmtub3duKSB7XG4gICAgICAgICAgICBjb25zdCBtc2cgPSBgVGFzayBmYWlsZWQ6ICR7U3RyaW5nKGVycil9YDtcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IobXNnKTtcbiAgICAgICAgICAgIGF3YWl0IGV4dGVuc2lvbkFwaS53aW5kb3cuc2hvd0Vycm9yTWVzc2FnZShtc2cpO1xuXG4gICAgICAgICAgICB0aHJvdyBlcnI7XG4gICAgICAgIH1cbiAgICB9KTtcblxuICAgIHRyeSB7XG4gICAgICAgIC8vIGNyZWF0ZSBhbiBpdGVtIGluIHRoZSBzdGF0dXMgYmFyIHRvIHJ1biBvdXIgY29tbWFuZFxuICAgICAgICAvLyBpdCB3aWxsIHN0aWNrIG9uIHRoZSBsZWZ0IG9mIHRoZSBzdGF0dXMgYmFyXG5cdFN0YXR1c0JhciA9IGV4dGVuc2lvbkFwaS53aW5kb3cuY3JlYXRlU3RhdHVzQmFySXRlbShleHRlbnNpb25BcGkuU3RhdHVzQmFyQWxpZ25MZWZ0LCAxMDApO1xuXG5cdHNldFN0YXR1cyhcIuKame+4jyBJbml0aWFsaXppbmcgLi4uXCIpO1xuICAgICAgICBTdGF0dXNCYXIuY29tbWFuZCA9ICdsbGFtYS5jcHAuYXBpci5tZW51JztcbiAgICAgICAgU3RhdHVzQmFyLnNob3coKTtcblxuICAgICAgICAvLyByZWdpc3RlciBkaXNwb3NhYmxlIHJlc291cmNlcyB0byBpdCdzIHJlbW92ZWQgd2hlbiB5b3UgZGVhY3RpdnRlIHRoZSBleHRlbnNpb25cbiAgICAgICAgZXh0ZW5zaW9uQ29udGV4dC5zdWJzY3JpcHRpb25zLnB1c2gobWVudUNvbW1hbmQpO1xuICAgICAgICBleHRlbnNpb25Db250ZXh0LnN1YnNjcmlwdGlvbnMucHVzaChTdGF0dXNCYXIpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnN0IG1zZyA9IGBDb3VsZG4ndCBzdWJzY3JpYmUgdGhlIGV4dGVuc2lvbiB0byBQb2RtYW4gRGVza3RvcDogJHtlcnJvcn1gXG5cbiAgICAgICAgYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93RXJyb3JNZXNzYWdlKG1zZyk7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihtc2cpO1xuICAgIH1cblxuICAgIHRyeSB7XG5cdHNldFN0YXR1cyhcIkluc3RhbGxpbmcgLi4uXCIpXG5cdGF3YWl0IGluc3RhbGxBcGlyQmluYXJpZXMoKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuXHRyZXR1cm47IC8vIG1lc3NhZ2UgYWxyZWFkeSBwcmludGVkIG9uIHNjcmVlblxuICAgIH1cblxuICAgIHNldFN0YXR1cyhg4pqZ77iPIExvYWRpbmcgdGhlIG1vZGVscyAuLi5gKTtcbiAgICB0cnkge1xuXHRyZWZyZXNoQXZhaWxhYmxlTW9kZWxzKCk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc3QgbXNnID0gYENvdWxkbid0IGluaXRpYWxpemUgdGhlIGV4dGVuc2lvbjogJHtlcnJvcn1gXG5cbiAgICAgICAgYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93RXJyb3JNZXNzYWdlKG1zZyk7XG5cdHNldFN0YXR1cyhg8J+UtCAke21zZ31gKTtcblx0cmV0dXJuXG4gICAgfVxuXG4gICAgc2V0U3RhdHVzKCk7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBkZWFjdGl2YXRlKCk6IFByb21pc2U8dm9pZD4ge1xuXG59XG5cbmFzeW5jIGZ1bmN0aW9uIGluc3RhbGxBcGlyQmluYXJpZXMoKSB7XG4gICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgaW5pdGlhbGl6ZUJ1aWxkRGlyKEVYVEVOU0lPTl9CVUlMRF9QQVRIKTtcbiAgICAgICAgY29uc29sZS5sb2coYEluc3RhbGxpbmcgQVBJUiB2ZXJzaW9uICR7QXBpclZlcnNpb259IC4uLmApO1xuXHRTdGF0dXNCYXIudG9vbHRpcCA9IGB2ZXJzaW9uICR7QXBpclZlcnNpb259YDtcbiAgICAgICAgY29uc29sZS5sb2coYFVzaW5nIGltYWdlICR7UmFtYWxhbWFSZW1vdGluZ0ltYWdlfWApO1xuXG5cdHNldFN0YXR1cyhg4pqZ77iPIEV4dHJhY3RpbmcgdGhlIGJpbmFyaWVzIC4uLmApO1xuICAgICAgICBhd2FpdCBpbml0aWFsaXplU3RvcmFnZURpcihFeHRlbnNpb25TdG9yYWdlUGF0aCwgRVhURU5TSU9OX0JVSUxEX1BBVEgpO1xuXG4gICAgICAgIHNldFN0YXR1cyhg4pqZ77iPIFByZXBhcmluZyBrcnVua2l0IC4uLmApO1xuICAgICAgICBhd2FpdCBwcmVwYXJlX2tydW5raXQoKTtcblx0c2V0U3RhdHVzKGDinIUgYmluYXJpZXMgaW5zdGFsbGVkYCk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc3QgbXNnID0gYENvdWxkbid0IGluaXRpYWxpemUgdGhlIGV4dGVuc2lvbjogJHtlcnJvcn1gXG5cdHNldFN0YXR1cyhg8J+UtCAke21zZ31gKTtcbiAgICAgICAgYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93RXJyb3JNZXNzYWdlKG1zZyk7XG5cdHRocm93IGVycm9yO1xuICAgIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gdW5pbnN0YWxsQXBpckJpbmFyaWVzKCkge1xuICAgIGlmIChFeHRlbnNpb25TdG9yYWdlUGF0aCA9PT0gdW5kZWZpbmVkKSB0aHJvdyBuZXcgRXJyb3IoJ0V4dGVuc2lvblN0b3JhZ2VQYXRoIG5vdCBkZWZpbmVkIDovJyk7XG4gICAgc2V0U3RhdHVzKGDimpnvuI8gVW5pbnN0YWxsaW5nIHRoZSBiaW5hcmllcyAuLi5gKTtcbiAgICBjb25zdCB0b0RlbGV0ZSA9IFtdO1xuXG4gICAgcmVnaXN0ZXJGcm9tRGlyKEV4dGVuc2lvblN0b3JhZ2VQYXRoLCAnY2hlY2tfcG9kbWFuX21hY2hpbmVfc3RhdHVzLnNoJywgZnVuY3Rpb24oZmlsZW5hbWUpIHt0b0RlbGV0ZS5wdXNoKHBhdGguZGlybmFtZShmaWxlbmFtZSkpfSk7XG5cbiAgICBmb3IgKGNvbnN0IGRpck5hbWUgb2YgdG9EZWxldGUpIHtcblx0Y29uc29sZS53YXJuKFwi4pqg77iPIGRlbGV0aW5nIEFQSVIgZGlyZWN0b3J5OiBcIiwgZGlyTmFtZSk7XG5cblx0ZnMucm1TeW5jKGRpck5hbWUsIHsgcmVjdXJzaXZlOiB0cnVlLCBmb3JjZTogdHJ1ZSB9KTtcbiAgICB9XG4gICAgY29uc29sZS53YXJuKFwi4pqg77iPIGRlbGV0aW5nIGRvbmVcIik7XG5cbiAgICBzZXRTdGF0dXMoYOKchSBiaW5hcmllcyB1bmluc3RhbGxlZCDwn5GLYCk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGdldENvbm5lY3Rpb25OYW1lKGFsbG93VW5kZWZpbmVkID0gZmFsc2UpOiBQcm9taXNlPHN0cmluZyB8IHVuZGVmaW5lZD4ge1xuICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IGNvbm5lY3Rpb24gPSBnZXRDb25uZWN0aW9uKGFsbG93VW5kZWZpbmVkKTtcbiAgICAgICAgY29uc3QgY29ubmVjdGlvbk5hbWUgPSBjb25uZWN0aW9uPy5bXCJuYW1lXCJdO1xuXG4gICAgICAgIGlmICghYWxsb3dVbmRlZmluZWQgJiYgY29ubmVjdGlvbk5hbWUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdjYW5ub3QgZmluZCBwb2RtYW4gY29ubmVjdGlvbiBuYW1lJyk7XG4gICAgICAgIH1cblx0aWYgKGNvbm5lY3Rpb25OYW1lKSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZyhcIkNvbm5lY3RpbmcgdG9cIiwgY29ubmVjdGlvbk5hbWUpO1xuXHR9XG4gICAgICAgIHJldHVybiBjb25uZWN0aW9uTmFtZTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zdCBtc2cgPSBgRmFpbGVkIHRvIGdldCB0aGUgZGVmYXVsdCBjb25uZWN0aW9uIHRvIFBvZG1hbjogJHtlcnJvcn1gXG4gICAgICAgIGF3YWl0IGV4dGVuc2lvbkFwaS53aW5kb3cuc2hvd0Vycm9yTWVzc2FnZShtc2cpO1xuICAgICAgICBjb25zb2xlLmVycm9yKG1zZyk7XG5cdHNldFN0YXR1cyhg8J+UtCAke21zZ31gKTtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKG1zZyk7XG4gICAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiByZXN0YXJ0X3BvZG1hbl9tYWNoaW5lX3dpdGhfYXBpcigpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoTG9jYWxCdWlsZERpciA9PT0gdW5kZWZpbmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJMb2NhbEJ1aWxkRGlyIG5vdCBsb2FkZWQuIFRoaXMgaXMgdW5leHBlY3RlZC5cIik7XG5cbiAgICBjb25zdCBjb25uZWN0aW9uTmFtZSA9IGF3YWl0IGdldENvbm5lY3Rpb25OYW1lKCk7XG5cbiAgICB0cnkge1xuXHRzZXRTdGF0dXMoXCLimpnvuI8gUmVzdGFydGluZyBQb2RNYW4gTWFjaGluZSB3aXRoIEFQSSBSZW1vdGluZyBzdXBwb3J0IC4uLlwiKVxuICAgICAgICBjb25zdCB7IHN0ZG91dCB9ID0gYXdhaXQgZXh0ZW5zaW9uQXBpLnByb2Nlc3MuZXhlYyhcIi91c3IvYmluL2VudlwiLCBbXCJiYXNoXCIsIGAke0xvY2FsQnVpbGREaXJ9L3BvZG1hbl9zdGFydF9tYWNoaW5lLmFwaV9yZW1vdGluZy5zaGAsIGNvbm5lY3Rpb25OYW1lXSwge2N3ZDogTG9jYWxCdWlsZERpcn0pO1xuXG4gICAgICAgIGNvbnN0IG1zZyA9IFwi8J+foiBQb2RNYW4gTWFjaGluZSBzdWNjZXNzZnVsbHkgcmVzdGFydGVkIHdpdGggQVBJIFJlbW90aW5nIHN1cHBvcnRcIlxuICAgICAgICBhd2FpdCBleHRlbnNpb25BcGkud2luZG93LnNob3dJbmZvcm1hdGlvbk1lc3NhZ2UobXNnKTtcbiAgICAgICAgY29uc29sZS5sb2cobXNnKTtcblx0c2V0U3RhdHVzKFwi8J+foiBBUEkgUmVtb3Rpbmcgc3VwcG9ydCBlbmFibGVkXCIpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnN0IG1zZyA9IGBGYWlsZWQgdG8gcmVzdGFydCBQb2RNYW4gTWFjaGluZSB3aXRoIHRoZSBBUEkgUmVtb3Rpbmcgc3VwcG9ydDogJHtlcnJvcn1gXG4gICAgICAgIGF3YWl0IGV4dGVuc2lvbkFwaS53aW5kb3cuc2hvd0Vycm9yTWVzc2FnZShtc2cpO1xuICAgICAgICBjb25zb2xlLmVycm9yKG1zZyk7XG5cdHNldFN0YXR1cyhg8J+UtCAke21zZ31gKTtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKG1zZyk7XG4gICAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiByZXN0YXJ0X3BvZG1hbl9tYWNoaW5lX3dpdGhvdXRfYXBpcigpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBjb25uZWN0aW9uTmFtZSA9IGF3YWl0IGdldENvbm5lY3Rpb25OYW1lKCk7XG5cbiAgICB0cnkge1xuXHRzZXRTdGF0dXMoXCLimpnvuI8gU3RvcHBpbmcgdGhlIFBvZE1hbiBNYWNoaW5lIC4uLlwiKVxuICAgICAgICBjb25zdCB7IHN0ZG91dCB9ID0gYXdhaXQgZXh0ZW5zaW9uQXBpLnByb2Nlc3MuZXhlYyhcInBvZG1hblwiLCBbJ21hY2hpbmUnLCAnc3RvcCcsIGNvbm5lY3Rpb25OYW1lXSk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc3QgbXNnID0gYEZhaWxlZCB0byBzdG9wIHRoZSBQb2RNYW4gTWFjaGluZTogJHtlcnJvcn1gO1xuXHRzZXRTdGF0dXMoYPCflLQgJHttc2d9YCk7XG4gICAgICAgIGF3YWl0IGV4dGVuc2lvbkFwaS53aW5kb3cuc2hvd0Vycm9yTWVzc2FnZShtc2cpO1xuICAgICAgICBjb25zb2xlLmVycm9yKG1zZyk7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihtc2cpO1xuICAgIH1cblxuICAgIHRyeSB7XG5cdHNldFN0YXR1cyhcIuKame+4jyBSZXN0YXJ0aW5nIHRoZSBkZWZhdWx0IFBvZE1hbiBNYWNoaW5lIC4uLlwiKVxuICAgICAgICBjb25zdCB7IHN0ZG91dCB9ID0gYXdhaXQgZXh0ZW5zaW9uQXBpLnByb2Nlc3MuZXhlYyhcInBvZG1hblwiLCBbJ21hY2hpbmUnLCAnc3RhcnQnLCBjb25uZWN0aW9uTmFtZV0pO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnN0IG1zZyA9IGBGYWlsZWQgdG8gcmVzdGFydCB0aGUgUG9kTWFuIE1hY2hpbmU6ICR7ZXJyb3J9YDtcblx0c2V0U3RhdHVzKGDwn5S0ICR7bXNnfWApO1xuICAgICAgICBhd2FpdCBleHRlbnNpb25BcGkud2luZG93LnNob3dFcnJvck1lc3NhZ2UobXNnKTtcbiAgICAgICAgY29uc29sZS5lcnJvcihtc2cpO1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IobXNnKTtcbiAgICB9XG5cbiAgICBjb25zdCBtc2cgPSBcIlBvZE1hbiBNYWNoaW5lIHN1Y2Nlc3NmdWxseSByZXN0YXJ0ZWQgd2l0aG91dCBBUEkgUmVtb3Rpbmcgc3VwcG9ydFwiO1xuICAgIGF3YWl0IGV4dGVuc2lvbkFwaS53aW5kb3cuc2hvd0luZm9ybWF0aW9uTWVzc2FnZShtc2cpO1xuICAgIGNvbnNvbGUubG9nKG1zZyk7XG4gICAgc2V0U3RhdHVzKFwi8J+foCBSdW5uaW5nIHdpdGhvdXQgQVBJIFJlbW90aW5nIHN1cHBvcnRcIilcbn1cblxuYXN5bmMgZnVuY3Rpb24gcHJlcGFyZV9rcnVua2l0KCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmIChMb2NhbEJ1aWxkRGlyID09PSB1bmRlZmluZWQpIHRocm93IG5ldyBFcnJvcihcIkxvY2FsQnVpbGREaXIgbm90IGxvYWRlZC4gVGhpcyBpcyB1bmV4cGVjdGVkLlwiKTtcblxuICAgIGlmIChmcy5leGlzdHNTeW5jKGAke0xvY2FsQnVpbGREaXJ9L2Jpbi9rcnVua2l0YCkpIHtcbiAgICAgICAgY29uc29sZS5sb2coXCJCaW5hcmllcyBhbHJlYWR5IHByZXBhcmVkLlwiKVxuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgc2V0U3RhdHVzKGDimpnvuI8gUHJlcGFyaW5nIHRoZSBrcnVua2l0IGJpbmFyaWVzIGZvciBBUEkgUmVtb3RpbmcgLi4uYCk7XG4gICAgaWYgKCFmcy5leGlzdHNTeW5jKGAke0xvY2FsQnVpbGREaXJ9L3VwZGF0ZV9rcnVua2l0LnNoYCkpIHtcblx0Y29uc3QgbXNnID0gYENhbm5vdCBwcmVwYXJlIHRoZSBrcnVua2l0IGJpbmFyaWVzOiAke0xvY2FsQnVpbGREaXJ9L3VwZGF0ZV9rcnVua2l0LnNoIGRvZXMgbm90IGV4aXN0YFxuXHRjb25zb2xlLmVycm9yKG1zZyk7XG5cdHRocm93IG5ldyBFcnJvcihtc2cpO1xuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHsgc3Rkb3V0IH0gPSBhd2FpdCBleHRlbnNpb25BcGkucHJvY2Vzcy5leGVjKFwiL3Vzci9iaW4vZW52XCIsIFtcImJhc2hcIiwgYCR7TG9jYWxCdWlsZERpcn0vdXBkYXRlX2tydW5raXQuc2hgXSwge2N3ZDogTG9jYWxCdWlsZERpcn0pO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoZXJyb3IpO1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYENvdWxkbid0IHVwZGF0ZSB0aGUga3J1bmtpdCBiaW5hcmllczogJHtlcnJvcn06ICR7ZXJyb3Iuc3Rkb3V0fWApO1xuICAgIH1cbiAgICBzZXRTdGF0dXMoYOKchSBiaW5hcmllcyBwcmVwYXJlZCFgKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gY2hlY2tQb2RtYW5NYWNoaW5lU3RhdHVzKHdpdGhfZ3VpOiBib29sZWFuKTogUHJvbWlzZTxudW1iZXI+IHtcbiAgICBpZiAoIWZzLmV4aXN0c1N5bmMoYCR7TG9jYWxCdWlsZERpcn0vY2hlY2tfcG9kbWFuX21hY2hpbmVfc3RhdHVzLnNoYCkpIHtcblx0Y29uc29sZS5sb2coYGNoZWNrUG9kbWFuTWFjaGluZVN0YXR1czogc2NyaXB0IG5vdCBmb3VuZCBpbiAke0xvY2FsQnVpbGREaXJ9YClcblx0c2V0U3RhdHVzKFwi4puUIG5vdCBpbnN0YWxsZWRcIik7XG5cdGlmICh3aXRoX2d1aSkge1xuXHQgICAgYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93SW5mb3JtYXRpb25NZXNzYWdlKFwi4puUIEFQSSBSZW1vdGluZyBiaW5hcmllcyBhcmUgbm90IGluc3RhbGxlZFwiKTtcbiAgICAgICAgfVxuXHRyZXR1cm4gMTI3O1xuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHsgc3Rkb3V0IH0gPSBhd2FpdCBleHRlbnNpb25BcGkucHJvY2Vzcy5leGVjKFwiL3Vzci9iaW4vZW52XCIsIFtcImJhc2hcIiwgYCR7TG9jYWxCdWlsZERpcn0vY2hlY2tfcG9kbWFuX21hY2hpbmVfc3RhdHVzLnNoYF0sIHtjd2Q6IExvY2FsQnVpbGREaXJ9KTtcbiAgICAgICAgLy8gZXhpdCB3aXRoIHN1Y2Nlc3MsIGtydW5raXQgaXMgcnVubmluZyBBUEkgcmVtb3RpbmdcbiAgICAgICAgY29uc3Qgc3RhdHVzID0gc3Rkb3V0LnJlcGxhY2UoL1xcbiQvLCBcIlwiKVxuICAgICAgICBjb25zdCBtc2cgPSBgUG9kbWFuIE1hY2hpbmUgQVBJIFJlbW90aW5nIHN0YXR1czpcXG4ke3N0YXR1c31gXG4gICAgICAgIGlmICh3aXRoX2d1aSkge1xuICAgICAgICAgICAgYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93SW5mb3JtYXRpb25NZXNzYWdlKG1zZyk7XG4gICAgICAgIH1cbiAgICAgICAgY29uc29sZS5sb2cobXNnKTtcblx0Y29uc3QgY29udGFpbmVySW5mbyA9IGF3YWl0IGhhc0FwaXJDb250YWluZXJSdW5uaW5nKCk7XG5cdGlmIChjb250YWluZXJJbmZvICE9PSB1bmRlZmluZWQpIHtcblx0ICAgIHNldFN0YXR1cyhg8J+foiBJbmZlcmVuY2UgU2VydmVyIHJ1bm5pbmdgKTtcblx0ICAgIHJldHVybiAxO1xuXHR9IGVsc2Uge1xuXHQgICAgc2V0U3RhdHVzKFwi8J+folwiKTtcblx0ICAgIHJldHVybiAwO1xuXHR9XG5cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBsZXQgbXNnO1xuICAgICAgICBjb25zdCBzdGF0dXMgPSBlcnJvci5zdGRvdXQucmVwbGFjZSgvXFxuJC8sIFwiXCIpXG4gICAgICAgIGNvbnN0IGV4aXRDb2RlID0gZXJyb3IuZXhpdENvZGU7XG5cbiAgICAgICAgaWYgKGV4aXRDb2RlID4gMTAgJiYgZXhpdENvZGUgPCAyMCkge1xuICAgICAgICAgICAgLy8gZXhpdCB3aXRoIGNvZGUgMXggPT0+IHN1Y2Nlc3NmdWwgY29tcGxldGlvbiwgYnV0IG5vdCBBUEkgUmVtb3Rpbmcgc3VwcG9ydFxuICAgICAgICAgICAgbXNnID1g8J+foCBQb2RtYW4gTWFjaGluZSBzdGF0dXM6ICR7c3RhdHVzfWA7XG4gICAgICAgICAgICBpZiAod2l0aF9ndWkpIHtcbiAgICAgICAgICAgICAgICBhd2FpdCBleHRlbnNpb25BcGkud2luZG93LnNob3dJbmZvcm1hdGlvbk1lc3NhZ2UobXNnKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNvbnNvbGUud2Fybihtc2cpXG5cdCAgICBpZiAoZXhpdENvZGUgPT09IDEwIHx8IGV4aXRDb2RlID09PSAxMikge1xuXHRcdHNldFN0YXR1cyhcIvCfn6AgUG9kTWFuIE1hY2hpbmUgcnVubmluZyB3aXRob3V0IEFQSSBSZW1vdGluZyBzdXBwb3J0XCIpO1xuXHQgICAgfSBlbHNlIGlmIChleGl0Q29kZSA9PT0gMTEpIHtcblx0XHRzZXRTdGF0dXMoXCLwn5+gIFBvZE1hbiBNYWNoaW5lIG5vdCBydW5uaW5nXCIpO1xuXHQgICAgfSBlbHNlIHtcblx0XHRzZXRTdGF0dXMoYPCflLQgSW52YWxpZCBjaGVjayBzdGF0dXMgJHtleGl0Q29kZX1gKVxuXHRcdGNvbnNvbGUud2FybihgSW52YWxpZCBjaGVjayBzdGF0dXMgJHtleGl0Q29kZX06ICR7ZXJyb3Iuc3Rkb3V0fWApXG5cdCAgICB9XG5cbiAgICAgICAgICAgIHJldHVybiBleGl0Q29kZTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIG90aGVyIGV4aXQgY29kZSBjcmFzaCBvZiB1bnN1Y2Nlc3NmdWwgY29tcGxldGlvblxuICAgICAgICBtc2cgPWBGYWlsZWQgdG8gY2hlY2sgUG9kTWFuIE1hY2hpbmUgc3RhdHVzOiAke3N0YXR1c30gKGNvZGUgIyR7ZXhpdENvZGV9KWA7XG4gICAgICAgIGF3YWl0IGV4dGVuc2lvbkFwaS53aW5kb3cuc2hvd0Vycm9yTWVzc2FnZShtc2cpO1xuICAgICAgICBjb25zb2xlLmVycm9yKG1zZyk7XG5cdHNldFN0YXR1cyhg8J+UtCAke21zZ31gKVxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IobXNnKTtcbiAgICB9XG59XG4iXSwibmFtZXMiOlsiY29udGFpbmVyRW5naW5lIiwiY29udGFpbmVySW5mbyIsImV4dGVuc2lvbkFwaSIsImlkIiwicHJvdmlkZXIiLCJjb25uZWN0aW9uIiwiaW1hZ2VJbmZv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
