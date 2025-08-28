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
  const connectionName = await getConnectionName(true);
  try {
    setStatus("⚙️ Restarting PodMan Machine with API Remoting support ...");
    const args = ["bash", `${LocalBuildDir}/podman_start_machine.api_remoting.sh`];
    if (connectionName !== void 0) {
      args.push(connectionName);
      console.log(`Using connection ${connectionName}`);
    } else {
      console.log(`Using the default connection`);
    }
    const { stdout } = await extensionApi__namespace.process.exec("/usr/bin/env", args, { cwd: LocalBuildDir });
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZXh0ZW5zaW9uLmpzIiwic291cmNlcyI6WyIuLi9zcmMvZXh0ZW5zaW9uLnRzIl0sInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB0eXBlIHtcbiAgICBDb250YWluZXJDcmVhdGVPcHRpb25zLFxuICAgIENvbnRhaW5lckNyZWF0ZVJlc3VsdCxcbiAgICBDb250YWluZXJQcm92aWRlckNvbm5lY3Rpb24sXG4gICAgRGV2aWNlLFxuICAgIExpc3RJbWFnZXNPcHRpb25zLFxuICAgIFB1bGxFdmVudCxcbiAgICBEZXZpY2VSZXF1ZXN0LFxuICAgIEltYWdlSW5mbyxcbiAgICBNb3VudENvbmZpZyxcbiAgICBQcm92aWRlckNvbnRhaW5lckNvbm5lY3Rpb24sXG59IGZyb20gJ0Bwb2RtYW4tZGVza3RvcC9hcGknO1xuXG5pbXBvcnQgKiBhcyBleHRlbnNpb25BcGkgZnJvbSAnQHBvZG1hbi1kZXNrdG9wL2FwaSc7XG5pbXBvcnQgdHlwZSB7IFBvZG1hbkNvbm5lY3Rpb24gfSBmcm9tICcuLi8uLi9tYW5hZ2Vycy9wb2RtYW5Db25uZWN0aW9uJztcbmltcG9ydCAqIGFzIFBvZG1hbkNvbm5lY3Rpb25BUEkgZnJvbSAnLi4vLi4vbWFuYWdlcnMvcG9kbWFuQ29ubmVjdGlvbic7XG5pbXBvcnQgeyBjb250YWluZXJFbmdpbmUsIHByb3ZpZGVyLCBQcm9ncmVzc0xvY2F0aW9uIH0gZnJvbSAnQHBvZG1hbi1kZXNrdG9wL2FwaSc7XG5cbmV4cG9ydCBjb25zdCBTRUNPTkQ6IG51bWJlciA9IDFfMDAwXzAwMF8wMDA7XG5cbmNvbnN0IHBhdGggPSByZXF1aXJlKCdwYXRoJyk7XG5jb25zdCBmcyA9IHJlcXVpcmUoJ2ZzJyk7XG5jb25zdCBhc3luY19mcyA9IHJlcXVpcmUoJ2ZzL3Byb21pc2VzJyk7XG5cbmNvbnN0IEF2YWlsYWJsZU1vZGVscyA9IHt9O1xubGV0IEV4dGVuc2lvblN0b3JhZ2VQYXRoID0gdW5kZWZpbmVkO1xuXG5jb25zdCBGQUlMX0lGX05PVF9NQUMgPSB0cnVlO1xuY29uc3QgRVhURU5TSU9OX0JVSUxEX1BBVEggPSBwYXRoLnBhcnNlKF9fZmlsZW5hbWUpLmRpciArIFwiLy4uL2J1aWxkXCI7XG5jb25zdCBSRVNUUklDVF9PUEVOX1RPX0dHVUZfRklMRVMgPSBmYWxzZTtcbmNvbnN0IFNFQVJDSF9BSV9MQUJfTU9ERUxTID0gdHJ1ZTtcblxubGV0IFJhbWFsYW1hUmVtb3RpbmdJbWFnZSA9IHVuZGVmaW5lZDtcbmxldCBBcGlyVmVyc2lvbiA9IHVuZGVmaW5lZDtcbmxldCBMb2NhbEJ1aWxkRGlyID0gdW5kZWZpbmVkO1xubGV0IFN0YXR1c0JhciA9IHVuZGVmaW5lZDtcbmxldCBOb0FpTGFiTW9kZWxXYXJuaW5nU2hvd24gPSBmYWxzZTtcblxuZnVuY3Rpb24gc2V0U3RhdHVzKHN0YXR1cykge1xuICAgIGNvbnNvbGUubG9nKGBBUEkgUmVtb3Rpbmcgc3RhdHVzOiAke3N0YXR1c31gKVxuICAgIGlmIChTdGF0dXNCYXIgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICBjb25zb2xlLndhcm4oXCJTdGF0dXMgYmFyIG5vdCBhdmFpbGFibGUgLi4uXCIpO1xuICAgICAgICByZXR1cm47XG4gICAgfVxuICAgIGlmIChzdGF0dXMgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICBTdGF0dXNCYXIudGV4dCA9IGBMbGFtYS5jcHAgQVBJIFJlbW90aW5nYFxuICAgIH0gZWxzZSB7XG4gICAgICAgIFN0YXR1c0Jhci50ZXh0ID0gYExsYW1hLmNwcCBBUEkgUmVtb3Rpbmc6ICR7c3RhdHVzfWBcbiAgICB9XG59XG5cbmZ1bmN0aW9uIHJlZ2lzdGVyRnJvbURpcihzdGFydFBhdGgsIGZpbHRlciwgcmVnaXN0ZXIpIHtcbiAgICBpZiAoIWZzLmV4aXN0c1N5bmMoc3RhcnRQYXRoKSkge1xuICAgICAgICBjb25zb2xlLmxvZyhcIm5vIGRpciBcIiwgc3RhcnRQYXRoKTtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHZhciBmaWxlcyA9IGZzLnJlYWRkaXJTeW5jKHN0YXJ0UGF0aCk7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBmaWxlcy5sZW5ndGg7IGkrKykge1xuICAgICAgICB2YXIgZmlsZW5hbWUgPSBwYXRoLmpvaW4oc3RhcnRQYXRoLCBmaWxlc1tpXSk7XG4gICAgICAgIHZhciBzdGF0ID0gZnMubHN0YXRTeW5jKGZpbGVuYW1lKTtcbiAgICAgICAgaWYgKHN0YXQuaXNEaXJlY3RvcnkoKSkge1xuICAgICAgICAgICAgcmVnaXN0ZXJGcm9tRGlyKGZpbGVuYW1lLCBmaWx0ZXIsIHJlZ2lzdGVyKTsgLy9yZWN1cnNlXG4gICAgICAgIH0gZWxzZSBpZiAoZmlsZW5hbWUuZW5kc1dpdGgoZmlsdGVyKSkge1xuICAgICAgICAgICAgcmVnaXN0ZXIoZmlsZW5hbWUpO1xuICAgICAgICB9O1xuICAgIH07XG59O1xuXG4vLyBnZW5lcmF0ZWQgYnkgY2hhdGdwdFxuYXN5bmMgZnVuY3Rpb24gY29weVJlY3Vyc2l2ZShzcmMsIGRlc3QpIHtcbiAgICBjb25zdCBlbnRyaWVzID0gYXdhaXQgYXN5bmNfZnMucmVhZGRpcihzcmMsIHsgd2l0aEZpbGVUeXBlczogdHJ1ZSB9KTtcblxuICAgIGF3YWl0IGFzeW5jX2ZzLm1rZGlyKGRlc3QsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuXG4gICAgZm9yIChsZXQgZW50cnkgb2YgZW50cmllcykge1xuICAgICAgICBjb25zdCBzcmNQYXRoID0gcGF0aC5qb2luKHNyYywgZW50cnkubmFtZSk7XG4gICAgICAgIGNvbnN0IGRlc3RQYXRoID0gcGF0aC5qb2luKGRlc3QsIGVudHJ5Lm5hbWUpO1xuXG4gICAgICAgIGlmIChlbnRyeS5pc0RpcmVjdG9yeSgpKSB7XG4gICAgICAgICAgICBhd2FpdCBjb3B5UmVjdXJzaXZlKHNyY1BhdGgsIGRlc3RQYXRoKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGF3YWl0IGFzeW5jX2ZzLmNvcHlGaWxlKHNyY1BhdGgsIGRlc3RQYXRoKTtcbiAgICAgICAgfVxuICAgIH1cbn1cblxuY29uc3QgZ2V0UmFuZG9tU3RyaW5nID0gKCk6IHN0cmluZyA9PiB7XG4gICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIHNvbmFyanMvcHNldWRvLXJhbmRvbVxuICAgIHJldHVybiAoTWF0aC5yYW5kb20oKSArIDEpLnRvU3RyaW5nKDM2KS5zdWJzdHJpbmcoNyk7XG59O1xuXG5mdW5jdGlvbiByZWZyZXNoQXZhaWxhYmxlTW9kZWxzKCkge1xuICAgIGlmICghU0VBUkNIX0FJX0xBQl9NT0RFTFMpIHtcbiAgICAgICAgY29uc29sZS5sb2coXCJTZWFyY2hpbmcgQUkgbGFiIG1vZGVscyBpcyBkaXNhYmxlZC4gU2tpcHBpbmcgcmVmcmVzaEF2YWlsYWJsZU1vZGVscy5cIilcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmIChFeHRlbnNpb25TdG9yYWdlUGF0aCA9PT0gdW5kZWZpbmVkKSB0aHJvdyBuZXcgRXJyb3IoJ0V4dGVuc2lvblN0b3JhZ2VQYXRoIG5vdCBkZWZpbmVkIDovJyk7XG5cbiAgICAvLyBkZWxldGUgdGhlIGV4aXN0aW5nIG1vZGVsc1xuICAgIE9iamVjdC5rZXlzKEF2YWlsYWJsZU1vZGVscykuZm9yRWFjaChrZXkgPT4gZGVsZXRlIEF2YWlsYWJsZU1vZGVsc1trZXldKTtcblxuICAgIGNvbnN0IHJlZ2lzdGVyTW9kZWwgPSBmdW5jdGlvbihmaWxlbmFtZSkge1xuICAgICAgICBjb25zdCBkaXJfbmFtZSA9IGZpbGVuYW1lLnNwbGl0KFwiL1wiKS5hdCgtMilcbiAgICAgICAgY29uc3QgbmFtZV9wYXJ0cyA9IGRpcl9uYW1lLnNwbGl0KFwiLlwiKVxuICAgICAgICAvLyAwIGlzIHRoZSBzb3VyY2UgKGVnLCBoZilcbiAgICAgICAgY29uc3QgbW9kZWxfZGlyID0gbmFtZV9wYXJ0cy5hdCgxKVxuICAgICAgICBjb25zdCBtb2RlbF9uYW1lID0gbmFtZV9wYXJ0cy5zbGljZSgyKS5qb2luKCcuJylcbiAgICAgICAgY29uc3QgbW9kZWxfdXNlcl9uYW1lID0gYCR7bW9kZWxfZGlyfS8ke21vZGVsX25hbWV9YFxuICAgICAgICBBdmFpbGFibGVNb2RlbHNbbW9kZWxfdXNlcl9uYW1lXSA9IGZpbGVuYW1lO1xuICAgICAgICBjb25zb2xlLmxvZyhgZm91bmQgJHttb2RlbF91c2VyX25hbWV9YClcbiAgICB9XG5cbiAgICByZWdpc3RlckZyb21EaXIoRXh0ZW5zaW9uU3RvcmFnZVBhdGggKyAnLy4uL3JlZGhhdC5haS1sYWIvbW9kZWxzJywgJy5nZ3VmJywgcmVnaXN0ZXJNb2RlbCk7XG59XG5cbmZ1bmN0aW9uIHNsZWVwKG1zKSB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKHJlc29sdmUgPT4gc2V0VGltZW91dChyZXNvbHZlLCBtcykpO1xufVxuXG5hc3luYyBmdW5jdGlvbiBoYXNBcGlyQ29udGFpbmVyUnVubmluZygpIHtcbiAgICBjb25zdCBjb250YWluZXJJbmZvID0gKGF3YWl0IGNvbnRhaW5lckVuZ2luZS5saXN0Q29udGFpbmVycygpKS5maW5kKFxuICAgICAgICBjb250YWluZXJJbmZvID0+XG4gICAgICAgIGNvbnRhaW5lckluZm8uTGFiZWxzPy5bJ2xsYW1hLWNwcC5hcGlyJ10gPT09ICd0cnVlJyAmJlxuICAgICAgICAgICAgY29udGFpbmVySW5mby5TdGF0ZSA9PT0gJ3J1bm5pbmcnLFxuICAgICk7XG5cbiAgICByZXR1cm4gY29udGFpbmVySW5mbztcbn1cblxuYXN5bmMgZnVuY3Rpb24gc3RvcEFwaXJJbmZlcmVuY2VTZXJ2ZXIoKSB7XG4gICAgY29uc3QgY29udGFpbmVySW5mbyA9IGF3YWl0IGhhc0FwaXJDb250YWluZXJSdW5uaW5nKCk7XG4gICAgaWYgKGNvbnRhaW5lckluZm8gPT09IHVuZGVmaW5lZCkge1xuICAgICAgICBjb25zdCBtc2cgPSBg8J+UtCBDb3VsZCBub3QgZmluZCBhbiBBUEkgUmVtb3RpbmcgY29udGFpbmVyIHJ1bm5pbmcgLi4uYFxuICAgICAgICBzZXRTdGF0dXMobXNnKTtcbiAgICAgICAgYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93RXJyb3JNZXNzYWdlKG1zZyk7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG4gICAgc2V0U3RhdHVzKFwi4pqZ77iPIFN0b3BwaW5nIHRoZSBpbmZlcmVuY2Ugc2VydmVyIC4uLlwiKVxuICAgIGF3YWl0IGNvbnRhaW5lckVuZ2luZS5zdG9wQ29udGFpbmVyKGNvbnRhaW5lckluZm8uZW5naW5lSWQsIGNvbnRhaW5lckluZm8uSWQpO1xuICAgIGF3YWl0IGNoZWNrUG9kbWFuTWFjaGluZVN0YXR1cyhmYWxzZSk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHNob3dSYW1hbGFtYUNoYXQoKSB7XG4gICAgY29uc3QgY29udGFpbmVySW5mbyA9IGF3YWl0IGhhc0FwaXJDb250YWluZXJSdW5uaW5nKCk7XG4gICAgaWYgKGNvbnRhaW5lckluZm8gPT09IHVuZGVmaW5lZCkge1xuICAgICAgICBjb25zdCBtc2cgPSBg8J+UtCBDb3VsZCBub3QgZmluZCBhbiBBUEkgUmVtb3RpbmcgY29udGFpbmVyIHJ1bm5pbmcgLi4uYFxuICAgICAgICBzZXRTdGF0dXMobXNnKTtcbiAgICAgICAgYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93RXJyb3JNZXNzYWdlKG1zZyk7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgYXBpX3VybCA9IGNvbnRhaW5lckluZm8/LkxhYmVscz8uYXBpO1xuXG4gICAgaWYgKCFhcGlfdXJsKSB7XG4gICAgICAgIGNvbnN0IG1zZyA9ICfwn5S0IE1pc3NpbmcgQVBJIFVSTCBsYWJlbCBvbiB0aGUgcnVubmluZyBBUElSIGNvbnRhaW5lci4nO1xuICAgICAgICBzZXRTdGF0dXMobXNnKTtcbiAgICAgICAgYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93RXJyb3JNZXNzYWdlKG1zZyk7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBhd2FpdCBleHRlbnNpb25BcGkud2luZG93LnNob3dJbnB1dEJveCh7XG4gICAgICAgIHRpdGxlOiBcInJhbWFsYW1hIGNoYXRcIixcbiAgICAgICAgcHJvbXB0OiBcIlJhbWFMYW1hIGNvbW1hbmQgdG8gY2hhdCB3aXRoIHRoZSBBUEkgUmVtb3RpbmcgbW9kZWxcIixcbiAgICAgICAgbXVsdGlsaW5lOiB0cnVlLFxuICAgICAgICB2YWx1ZTogYHJhbWFsYW1hIGNoYXQgLS11cmwgXCIke2FwaV91cmx9XCJgLFxuICAgIH0pO1xufVxuXG5hc3luYyBmdW5jdGlvbiBzaG93UmFtYWxhbWFSdW4oKSB7XG4gICAgaWYgKCFSYW1hbGFtYVJlbW90aW5nSW1hZ2UpIHtcbiAgICAgICAgYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93RXJyb3JNZXNzYWdlKCdBUElSIGltYWdlIGlzIG5vdCBsb2FkZWQgeWV0LicpO1xuICAgICAgICByZXR1cm47XG4gICAgfVxuICAgIGF3YWl0IGV4dGVuc2lvbkFwaS53aW5kb3cuc2hvd0lucHV0Qm94KHtcbiAgICAgICAgdGl0bGU6IFwicmFtYWxhbWEgcnVuXCIsXG4gICAgICAgIHByb21wdDogXCJSYW1hTGFtYSBjb21tYW5kIHRvIGxhdW5jaCBhIG1vZGVsXCIsXG4gICAgICAgIG11bHRpbGluZTogdHJ1ZSxcbiAgICAgICAgdmFsdWU6IGByYW1hbGFtYSBydW4gLS1pbWFnZSBcIiR7UmFtYWxhbWFSZW1vdGluZ0ltYWdlfVwiIGxsYW1hMy4yYCxcbiAgICB9KTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gc2hvd1JhbWFsYW1hQmVuY2htYXJrKCkge1xuICAgIGlmICghUmFtYWxhbWFSZW1vdGluZ0ltYWdlKSB7XG4gICAgICAgIGF3YWl0IGV4dGVuc2lvbkFwaS53aW5kb3cuc2hvd0Vycm9yTWVzc2FnZSgnQVBJUiBpbWFnZSBpcyBub3QgbG9hZGVkIHlldC4nKTtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGF3YWl0IGV4dGVuc2lvbkFwaS53aW5kb3cuc2hvd0lucHV0Qm94KHtcbiAgICAgICAgdGl0bGU6IFwicmFtYWxhbWEgYmVuY2hcIixcbiAgICAgICAgcHJvbXB0OiBcIlJhbWFMYW1hIGNvbW1hbmRzIHRvIHJ1biBiZW5jaG1hcmtzXCIsXG4gICAgICAgIG11bHRpbGluZTogdHJ1ZSxcbiAgICAgICAgdmFsdWU6IGBcbiMgVmVudXMtVnVsa2FuIGJlbmNobWFya2luZ1xucmFtYWxhbWEgYmVuY2ggbGxhbWEzLjJcblxuIyBOYXRpdmUgTWV0YWwgYmVuY2htYXJraW5nIChuZWVkcyBcXGBsbGFtYS1iZW5jaFxcYCBpbnN0YWxsZWQpXG5yYW1hbGFtYSAtLW5vY29udGFpbmVyIGJlbmNoIGxsYW1hMy4yXG5cbiMgQVBJIFJlbW90aW5nIGJlbmNobWFya1xucmFtYWxhbWEgYmVuY2ggIC0taW1hZ2UgXCIke1JhbWFsYW1hUmVtb3RpbmdJbWFnZX1cIiBsbGFtYTMuMlxuIyAoc2Nyb2xsIHVwIHRvIHNlZSBtb3JlKWBcbiAgICB9KTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gbGF1bmNoQXBpckluZmVyZW5jZVNlcnZlcigpIHtcbiAgICBjb25zdCBjb250YWluZXJJbmZvID0gYXdhaXQgaGFzQXBpckNvbnRhaW5lclJ1bm5pbmcoKTtcbiAgICBpZiAoY29udGFpbmVySW5mbyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIGNvbnN0IGlkID0gY29udGFpbmVySW5mby5JZDtcbiAgICAgICAgY29uc29sZS5lcnJvcihgQVBJIFJlbW90aW5nIGNvbnRhaW5lciAke2lkfSBhbHJlYWR5IHJ1bm5pbmcgLi4uYCk7XG4gICAgICAgIGF3YWl0IGV4dGVuc2lvbkFwaS53aW5kb3cuc2hvd0Vycm9yTWVzc2FnZShg8J+foCBBUEkgUmVtb3RpbmcgY29udGFpbmVyICR7aWR9IGlzIGFscmVhZHkgcnVubmluZy4gVGhpcyB2ZXJzaW9uIGNhbm5vdCBoYXZlIHR3byBBUEkgUmVtb3RpbmcgY29udGFpbmVycyBydW5uaW5nIHNpbXVsdGFuZW91c2x5LmApO1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKFJhbWFsYW1hUmVtb3RpbmdJbWFnZSA9PT0gdW5kZWZpbmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJSYW1hbGFtYSBSZW1vdGluZyBpbWFnZSBuYW1lIG5vdCBsb2FkZWQuIFRoaXMgaXMgdW5leHBlY3RlZC5cIik7XG5cbiAgICBzZXRTdGF0dXMoXCLimpnvuI8gQ29uZmlndXJpbmcgdGhlIGluZmVyZW5jZSBzZXJ2ZXIgLi4uXCIpXG4gICAgbGV0IG1vZGVsX25hbWU7XG4gICAgaWYgKE9iamVjdC5rZXlzKEF2YWlsYWJsZU1vZGVscykubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIGlmICghTm9BaUxhYk1vZGVsV2FybmluZ1Nob3duKSB7XG4gICAgICAgICAgICBhd2FpdCBleHRlbnNpb25BcGkud2luZG93LnNob3dJbmZvcm1hdGlvbk1lc3NhZ2UoYPCfn6AgQ291bGQgbm90IGZpbmQgYW55IG1vZGVsIGRvd25sb2FkZWQgZnJvbSBBSSBMYWIuIFBsZWFzZSBzZWxlY3QgYSBHR1VGIGZpbGUgdG8gbG9hZC5gKTtcbiAgICAgICAgICAgIE5vQWlMYWJNb2RlbFdhcm5pbmdTaG93biA9IHRydWU7XG4gICAgICAgIH1cbiAgICAgICAgbGV0IHVyaXMgPSBhd2FpdCBleHRlbnNpb25BcGkud2luZG93LnNob3dPcGVuRGlhbG9nKHtcbiAgICAgICAgICAgIHRpdGxlOiBcIlNlbGVjdCBhIEdHVUYgbW9kZWwgZmlsZVwiLFxuICAgICAgICAgICAgb3BlbkxhYmVsOiBcIlNlbGVjdFwiLFxuICAgICAgICAgICAgY2FuU2VsZWN0RmlsZXM6IHRydWUsXG4gICAgICAgICAgICBjYW5TZWxlY3RGb2xkZXJzOiBmYWxzZSxcbiAgICAgICAgICAgIGNhblNlbGVjdE1hbnk6IGZhbHNlLFxuICAgICAgICAgICAgZmlsdGVyczogeyAnR0dVRiBNb2RlbHMnOiBbJ2dndWYnXSB9LFxuICAgICAgICB9KVxuXG4gICAgICAgIGlmICghdXJpcyB8fCB1cmlzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgY29uc29sZS5sb2coXCJObyBtb2RlbCBzZWxlY3RlZCwgYWJvcnRpbmcgdGhlIEFQSVIgY29udGFpbmVyIGxhdW5jaCBzaWxlbnRseS5cIilcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBtb2RlbF9uYW1lID0gdXJpc1swXS5mc1BhdGg7XG5cbiAgICAgICAgaWYgKFJFU1RSSUNUX09QRU5fVE9fR0dVRl9GSUxFUykge1xuICAgICAgICAgICAgaWYgKHBhdGguZXh0bmFtZShtb2RlbF9uYW1lKS50b0xvd2VyQ2FzZSgpICE9PSAnLmdndWYnKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgbXNnID0gYFNlbGVjdGVkIGZpbGUgaXNuJ3QgYSAuZ2d1ZjogJHttb2RlbF9uYW1lfWBcbiAgICAgICAgICAgICAgICBjb25zb2xlLndhcm4obXNnKTtcbiAgICAgICAgICAgICAgICBhd2FpdCBleHRlbnNpb25BcGkud2luZG93LnNob3dFcnJvck1lc3NhZ2UobXNnKTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIWZzLmV4aXN0c1N5bmMobW9kZWxfbmFtZSkpe1xuICAgICAgICAgICAgY29uc3QgbXNnID0gYFNlbGVjdGVkIEdHVUYgbW9kZWwgZmlsZSBkb2VzIG5vdCBleGlzdDogJHttb2RlbF9uYW1lfWBcbiAgICAgICAgICAgIGNvbnNvbGUud2Fybihtc2cpO1xuICAgICAgICAgICAgYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93RXJyb3JNZXNzYWdlKG1zZyk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuXG4gICAgfSBlbHNlIHtcbiAgICAgICAgcmVmcmVzaEF2YWlsYWJsZU1vZGVscygpO1xuXG4gICAgICAgIC8vIGRpc3BsYXkgYSBjaG9pY2UgdG8gdGhlIHVzZXIgZm9yIHNlbGVjdGluZyBzb21lIHZhbHVlc1xuICAgICAgICBtb2RlbF9uYW1lID0gYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93UXVpY2tQaWNrKE9iamVjdC5rZXlzKEF2YWlsYWJsZU1vZGVscyksIHtcbiAgICAgICAgICAgIGNhblBpY2tNYW55OiBmYWxzZSwgLy8gdXNlciBjYW4gc2VsZWN0IG1vcmUgdGhhbiBvbmUgY2hvaWNlXG4gICAgICAgICAgICB0aXRsZTogXCJDaG9vc2UgdGhlIG1vZGVsIHRvIGRlcGxveVwiLFxuICAgICAgICB9KTtcbiAgICAgICAgaWYgKG1vZGVsX25hbWUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgY29uc29sZS53YXJuKCdObyBtb2RlbCBjaG9zZW4sIG5vdGhpbmcgdG8gbGF1bmNoLicpXG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBwcmVwYXJlIHRoZSBwb3J0XG5cbiAgICBjb25zdCBob3N0X3BvcnRfc3RyID0gYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93SW5wdXRCb3goe1xuICAgICAgICB0aXRsZTogXCJTZXJ2aWNlIHBvcnRcIixcbiAgICAgICAgcHJvbXB0OiBcIkluZmVyZW5jZSBzZXJ2aWNlIHBvcnQgb24gdGhlIGhvc3RcIixcbiAgICAgICAgdmFsdWU6IFwiMTIzNFwiLFxuICAgICAgICB2YWxpZGF0ZUlucHV0OiAodmFsdWUpID0+IChwYXJzZUludCh2YWx1ZSwgMTApID4gMTAyNCA/IFwiXCIgOiBcIkVudGVyIGEgdmFsaWQgcG9ydCA+IDEwMjRcIiksXG4gICAgfSk7XG4gICAgY29uc3QgaG9zdF9wb3J0ID0gaG9zdF9wb3J0X3N0ciA/IHBhcnNlSW50KGhvc3RfcG9ydF9zdHIsIDEwKSA6IE51bWJlci5OYU47XG5cbiAgICBpZiAoTnVtYmVyLmlzTmFOKGhvc3RfcG9ydCkpIHtcbiAgICAgICAgY29uc29sZS53YXJuKCdObyBob3N0IHBvcnQgY2hvc2VuLCBub3RoaW5nIHRvIGxhdW5jaC4nKVxuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgc2V0U3RhdHVzKFwi4pqZ77iPIFB1bGxpbmcgdGhlIGltYWdlIC4uLlwiKVxuICAgIC8vIHB1bGwgdGhlIGltYWdlXG4gICAgY29uc3QgaW1hZ2VJbmZvOiBJbWFnZUluZm8gPSBhd2FpdCBwdWxsSW1hZ2UoXG4gICAgICAgIFJhbWFsYW1hUmVtb3RpbmdJbWFnZSxcbiAgICAgICAge30sXG4gICAgKTtcblxuICAgIHNldFN0YXR1cyhcIuKame+4jyBDcmVhdGluZyB0aGUgY29udGFpbmVyIC4uLlwiKVxuICAgIC8vIGdldCBtb2RlbCBtb3VudCBzZXR0aW5nc1xuICAgIGNvbnN0IG1vZGVsX3NyYzogc3RyaW5nID0gQXZhaWxhYmxlTW9kZWxzW21vZGVsX25hbWVdID8/IG1vZGVsX25hbWU7XG5cbiAgICBpZiAobW9kZWxfc3JjID09PSB1bmRlZmluZWQpXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgQ291bGRuJ3QgZ2V0IHRoZSBmaWxlIGFzc29jaWF0ZWQgd2l0aCBtb2RlbCAke21vZGVsX3NyY30uIFRoaXMgaXMgdW5leHBlY3RlZC5gKTtcblxuICAgIGNvbnN0IG1vZGVsX2ZpbGVuYW1lID0gcGF0aC5iYXNlbmFtZShtb2RlbF9zcmMpO1xuICAgIGNvbnN0IG1vZGVsX2Rpcm5hbWUgPSBwYXRoLmJhc2VuYW1lKHBhdGguZGlybmFtZShtb2RlbF9zcmMpKTtcbiAgICBjb25zdCBtb2RlbF9kZXN0ID0gYC9tb2RlbHMvJHttb2RlbF9maWxlbmFtZX1gO1xuICAgIGNvbnN0IGFpX2xhYl9wb3J0ID0gMTA0MzQ7XG5cbiAgICAvLyBwcmVwYXJlIHRoZSBsYWJlbHNcbiAgICBjb25zdCBsYWJlbHM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7XG4gICAgICAgIFsnYWktbGFiLWluZmVyZW5jZS1zZXJ2ZXInXTogSlNPTi5zdHJpbmdpZnkoW21vZGVsX2Rpcm5hbWVdKSxcbiAgICAgICAgWydhcGknXTogYGh0dHA6Ly8xMjcuMC4wLjE6JHtob3N0X3BvcnR9L3YxYCxcbiAgICAgICAgWydkb2NzJ106IGBodHRwOi8vMTI3LjAuMC4xOiR7YWlfbGFiX3BvcnR9L2FwaS1kb2NzLyR7aG9zdF9wb3J0fWAsXG4gICAgICAgIFsnZ3B1J106IGBsbGFtYS5jcHAgQVBJIFJlbW90aW5nYCxcbiAgICAgICAgW1widHJhY2tpbmdJZFwiXTogZ2V0UmFuZG9tU3RyaW5nKCksXG4gICAgICAgIFtcImxsYW1hLWNwcC5hcGlyXCJdOiBcInRydWVcIixcbiAgICB9O1xuXG4gICAgLy8gcHJlcGFyZSB0aGUgbW91bnRzXG4gICAgLy8gbW91bnQgdGhlIGZpbGUgZGlyZWN0b3J5IHRvIGF2b2lkIGFkZGluZyBvdGhlciBmaWxlcyB0byB0aGUgY29udGFpbmVyc1xuICAgIGNvbnN0IG1vdW50czogTW91bnRDb25maWcgPSBbXG4gICAgICAgIHtcbiAgICAgICAgICAgIFRhcmdldDogbW9kZWxfZGVzdCxcbiAgICAgICAgICAgIFNvdXJjZTogbW9kZWxfc3JjLFxuICAgICAgICAgICAgVHlwZTogJ2JpbmQnLFxuICAgICAgICAgICAgUmVhZE9ubHk6IHRydWUsXG4gICAgICAgIH0sXG4gICAgXTtcblxuICAgIC8vIHByZXBhcmUgdGhlIGVudHJ5cG9pbnRcbiAgICBsZXQgZW50cnlwb2ludDogc3RyaW5nIHwgdW5kZWZpbmVkID0gdW5kZWZpbmVkO1xuICAgIGxldCBjbWQ6IHN0cmluZ1tdID0gW107XG5cbiAgICBlbnRyeXBvaW50ID0gXCIvdXNyL2Jpbi9sbGFtYS1zZXJ2ZXIuc2hcIjtcblxuICAgIC8vIHByZXBhcmUgdGhlIGVudlxuICAgIGNvbnN0IGVudnM6IHN0cmluZ1tdID0gW2BNT0RFTF9QQVRIPSR7bW9kZWxfZGVzdH1gLCAnSE9TVD0wLjAuMC4wJywgJ1BPUlQ9ODAwMCcsICdHUFVfTEFZRVJTPTk5OSddO1xuXG4gICAgLy8gcHJlcGFyZSB0aGUgZGV2aWNlc1xuICAgIGNvbnN0IGRldmljZXM6IERldmljZVtdID0gW107XG4gICAgZGV2aWNlcy5wdXNoKHtcbiAgICAgICAgUGF0aE9uSG9zdDogJy9kZXYvZHJpJyxcbiAgICAgICAgUGF0aEluQ29udGFpbmVyOiAnL2Rldi9kcmknLFxuICAgICAgICBDZ3JvdXBQZXJtaXNzaW9uczogJycsXG4gICAgfSk7XG5cbiAgICBjb25zdCBkZXZpY2VSZXF1ZXN0czogRGV2aWNlUmVxdWVzdFtdID0gW107XG4gICAgZGV2aWNlUmVxdWVzdHMucHVzaCh7XG4gICAgICAgIENhcGFiaWxpdGllczogW1snZ3B1J11dLFxuICAgICAgICBDb3VudDogLTEsIC8vIC0xOiBhbGxcbiAgICB9KTtcblxuICAgIC8vIEdldCB0aGUgY29udGFpbmVyIGNyZWF0aW9uIG9wdGlvbnNcbiAgICBjb25zdCBjb250YWluZXJDcmVhdGVPcHRpb25zOiBDb250YWluZXJDcmVhdGVPcHRpb25zID0ge1xuICAgICAgICBJbWFnZTogaW1hZ2VJbmZvLklkLFxuICAgICAgICBEZXRhY2g6IHRydWUsXG4gICAgICAgIEVudHJ5cG9pbnQ6IGVudHJ5cG9pbnQsXG4gICAgICAgIENtZDogY21kLFxuICAgICAgICBFeHBvc2VkUG9ydHM6IHsgW2Ake2hvc3RfcG9ydH0vdGNwYF06IHt9IH0sXG4gICAgICAgIEhvc3RDb25maWc6IHtcbiAgICAgICAgICAgIEF1dG9SZW1vdmU6IGZhbHNlLFxuICAgICAgICAgICAgRGV2aWNlczogZGV2aWNlcyxcbiAgICAgICAgICAgIE1vdW50czogbW91bnRzLFxuICAgICAgICAgICAgRGV2aWNlUmVxdWVzdHM6IGRldmljZVJlcXVlc3RzLFxuICAgICAgICAgICAgU2VjdXJpdHlPcHQ6IFtcImxhYmVsPWRpc2FibGVcIl0sXG4gICAgICAgICAgICBQb3J0QmluZGluZ3M6IHtcbiAgICAgICAgICAgICAgICAnODAwMC90Y3AnOiBbXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIEhvc3RQb3J0OiBgJHtob3N0X3BvcnR9YCxcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgfSxcblxuICAgICAgICBIZWFsdGhDaGVjazoge1xuICAgICAgICAgICAgLy8gbXVzdCBiZSB0aGUgcG9ydCBJTlNJREUgdGhlIGNvbnRhaW5lciBub3QgdGhlIGV4cG9zZWQgb25lXG4gICAgICAgICAgICBUZXN0OiBbJ0NNRC1TSEVMTCcsIGBjdXJsIC1zU2YgbG9jYWxob3N0OjgwMDAgPiAvZGV2L251bGxgXSxcbiAgICAgICAgICAgIEludGVydmFsOiBTRUNPTkQgKiA1LFxuICAgICAgICAgICAgUmV0cmllczogNCAqIDUsXG4gICAgICAgIH0sXG4gICAgICAgIExhYmVsczogbGFiZWxzLFxuICAgICAgICBFbnY6IGVudnMsXG4gICAgfTtcbiAgICBjb25zb2xlLmxvZyhjb250YWluZXJDcmVhdGVPcHRpb25zLCBtb3VudHMpXG4gICAgLy8gQ3JlYXRlIHRoZSBjb250YWluZXJcbiAgICBjb25zdCB7IGVuZ2luZUlkLCBpZCB9ID0gYXdhaXQgY3JlYXRlQ29udGFpbmVyKGltYWdlSW5mby5lbmdpbmVJZCwgY29udGFpbmVyQ3JlYXRlT3B0aW9ucywgbGFiZWxzKTtcbiAgICBzZXRTdGF0dXMoYPCfjokgSW5mZXJlbmNlIHNlcnZlciBpcyByZWFkeSBvbiBwb3J0ICR7aG9zdF9wb3J0fWApXG4gICAgYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93SW5mb3JtYXRpb25NZXNzYWdlKGDwn46JICR7bW9kZWxfbmFtZX0gaXMgcnVubmluZyB3aXRoIEFQSSBSZW1vdGluZyBhY2NlbGVyYXRpb24hYCk7XG5cbn1cbmV4cG9ydCB0eXBlIEJldHRlckNvbnRhaW5lckNyZWF0ZVJlc3VsdCA9IENvbnRhaW5lckNyZWF0ZVJlc3VsdCAmIHsgZW5naW5lSWQ6IHN0cmluZyB9O1xuXG5hc3luYyBmdW5jdGlvbiBjcmVhdGVDb250YWluZXIoXG4gICAgZW5naW5lSWQ6IHN0cmluZyxcbiAgICBjb250YWluZXJDcmVhdGVPcHRpb25zOiBDb250YWluZXJDcmVhdGVPcHRpb25zLFxuICAgIGxhYmVsczogeyBbaWQ6IHN0cmluZ106IHN0cmluZyB9LFxuKTogUHJvbWlzZTxCZXR0ZXJDb250YWluZXJDcmVhdGVSZXN1bHQ+IHtcblxuICAgIGNvbnNvbGUubG9nKFwiQ3JlYXRpbmcgY29udGFpbmVyIC4uLlwiKTtcbiAgICB0cnkge1xuICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBjb250YWluZXJFbmdpbmUuY3JlYXRlQ29udGFpbmVyKGVuZ2luZUlkLCBjb250YWluZXJDcmVhdGVPcHRpb25zKTtcbiAgICAgICAgY29uc29sZS5sb2coXCJDb250YWluZXIgY3JlYXRlZCFcIik7XG5cbiAgICAgICAgLy8gcmV0dXJuIHRoZSBDb250YWluZXJDcmVhdGVSZXN1bHRcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGlkOiByZXN1bHQuaWQsXG4gICAgICAgICAgICBlbmdpbmVJZDogZW5naW5lSWQsXG4gICAgICAgIH07XG4gICAgfSBjYXRjaCAoZXJyOiB1bmtub3duKSB7XG4gICAgICAgIGNvbnN0IG1zZyA9IGBDb250YWluZXIgY3JlYXRpb24gZmFpbGVkIDovICR7U3RyaW5nKGVycil9YFxuICAgICAgICBjb25zb2xlLmVycm9yKG1zZyk7XG4gICAgICAgIHNldFN0YXR1cyhcIvCflLQgQ29udGFpbmVyIGNyZWF0aW9uIGZhaWxlZFwiKVxuICAgICAgICBhd2FpdCBleHRlbnNpb25BcGkud2luZG93LnNob3dFcnJvck1lc3NhZ2UobXNnKTtcbiAgICAgICAgdGhyb3cgZXJyO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gZ2V0Q29ubmVjdGlvbihhbGxvd1VuZGVmaW5lZCA9IGZhbHNlKTogQ29udGFpbmVyUHJvdmlkZXJDb25uZWN0aW9uIHwgdW5kZWZpbmVkIHtcbiAgICBjb25zdCBwcm92aWRlcnM6IFByb3ZpZGVyQ29udGFpbmVyQ29ubmVjdGlvbltdID0gcHJvdmlkZXIuZ2V0Q29udGFpbmVyQ29ubmVjdGlvbnMoKTtcbiAgICBjb25zdCBwb2RtYW5Qcm92aWRlciA9IHByb3ZpZGVycy5maW5kKCh7IGNvbm5lY3Rpb24gfSkgPT4gY29ubmVjdGlvbi50eXBlID09PSAncG9kbWFuJyAmJiBjb25uZWN0aW9uLnN0YXR1cygpID09PSBcInN0YXJ0ZWRcIik7XG4gICAgaWYgKCFwb2RtYW5Qcm92aWRlcikge1xuICAgICAgICBpZiAoYWxsb3dVbmRlZmluZWQpIHtcbiAgICAgICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ2Nhbm5vdCBmaW5kIHBvZG1hbiBwcm92aWRlcicpO1xuICAgICAgICB9XG4gICAgfVxuICAgIGxldCBjb25uZWN0aW9uOiBDb250YWluZXJQcm92aWRlckNvbm5lY3Rpb24gPSBwb2RtYW5Qcm92aWRlci5jb25uZWN0aW9uO1xuXG4gICAgcmV0dXJuIGNvbm5lY3Rpb247XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHB1bGxJbWFnZShcbiAgICBpbWFnZTogc3RyaW5nLFxuICAgIGxhYmVsczogeyBbaWQ6IHN0cmluZ106IHN0cmluZyB9LFxuKTogUHJvbWlzZTxJbWFnZUluZm8+IHtcbiAgICAvLyBDcmVhdGluZyBhIHRhc2sgdG8gZm9sbG93IHB1bGxpbmcgcHJvZ3Jlc3NcbiAgICBjb25zb2xlLmxvZyhgUHVsbGluZyB0aGUgaW1hZ2UgJHtpbWFnZX0gLi4uYClcbiAgICBjb25zdCBjb25uZWN0aW9uID0gZ2V0Q29ubmVjdGlvbigpO1xuXG4gICAgLy8gZ2V0IHRoZSBkZWZhdWx0IGltYWdlIGluZm8gZm9yIHRoaXMgcHJvdmlkZXJcbiAgICByZXR1cm4gZ2V0SW1hZ2VJbmZvKGNvbm5lY3Rpb24sIGltYWdlLCAoX2V2ZW50OiBQdWxsRXZlbnQpID0+IHt9KVxuICAgICAgICAuY2F0Y2goKGVycjogdW5rbm93bikgPT4ge1xuICAgICAgICAgICAgY29uc29sZS5lcnJvcihgU29tZXRoaW5nIHdlbnQgd3Jvbmcgd2hpbGUgcHVsbGluZyAke2ltYWdlfTogJHtTdHJpbmcoZXJyKX1gKTtcbiAgICAgICAgICAgIHRocm93IGVycjtcbiAgICAgICAgfSlcbiAgICAgICAgLnRoZW4oaW1hZ2VJbmZvID0+IHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKFwiSW1hZ2UgcHVsbGVkIHN1Y2Nlc3NmdWxseVwiKTtcbiAgICAgICAgICAgIHJldHVybiBpbWFnZUluZm87XG4gICAgICAgIH0pO1xufVxuXG5hc3luYyBmdW5jdGlvbiBnZXRJbWFnZUluZm8oXG4gICAgY29ubmVjdGlvbjogQ29udGFpbmVyUHJvdmlkZXJDb25uZWN0aW9uLFxuICAgIGltYWdlOiBzdHJpbmcsXG4gICAgY2FsbGJhY2s6IChldmVudDogUHVsbEV2ZW50KSA9PiB2b2lkLFxuKTogUHJvbWlzZTxJbWFnZUluZm8+IHtcbiAgICBsZXQgaW1hZ2VJbmZvID0gdW5kZWZpbmVkO1xuXG4gICAgdHJ5IHtcbiAgICAgICAgLy8gUHVsbCBpbWFnZVxuICAgICAgICBhd2FpdCBjb250YWluZXJFbmdpbmUucHVsbEltYWdlKGNvbm5lY3Rpb24sIGltYWdlLCBjYWxsYmFjayk7XG5cbiAgICAgICAgLy8gR2V0IGltYWdlIGluc3BlY3RcbiAgICAgICAgaW1hZ2VJbmZvID0gKFxuICAgICAgICAgICAgYXdhaXQgY29udGFpbmVyRW5naW5lLmxpc3RJbWFnZXMoe1xuICAgICAgICAgICAgICAgIHByb3ZpZGVyOiBjb25uZWN0aW9uLFxuICAgICAgICAgICAgfSBhcyBMaXN0SW1hZ2VzT3B0aW9ucylcbiAgICAgICAgKS5maW5kKGltYWdlSW5mbyA9PiBpbWFnZUluZm8uUmVwb1RhZ3M/LnNvbWUodGFnID0+IHRhZyA9PT0gaW1hZ2UpKTtcblxuICAgIH0gY2F0Y2ggKGVycjogdW5rbm93bikge1xuICAgICAgICBjb25zb2xlLndhcm4oJ1NvbWV0aGluZyB3ZW50IHdyb25nIHdoaWxlIHRyeWluZyB0byBnZXQgaW1hZ2UgaW5zcGVjdCcsIGVycik7XG4gICAgICAgIGF3YWl0IGV4dGVuc2lvbkFwaS53aW5kb3cuc2hvd0Vycm9yTWVzc2FnZShgU29tZXRoaW5nIHdlbnQgd3Jvbmcgd2hpbGUgdHJ5aW5nIHRvIGdldCBpbWFnZSBpbnNwZWN0OiAke2Vycn1gKTtcblxuICAgICAgICB0aHJvdyBlcnI7XG4gICAgfVxuXG4gICAgaWYgKGltYWdlSW5mbyA9PT0gdW5kZWZpbmVkKSB0aHJvdyBuZXcgRXJyb3IoYGltYWdlICR7aW1hZ2V9IG5vdCBmb3VuZC5gKTtcblxuICAgIHJldHVybiBpbWFnZUluZm87XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGluaXRpYWxpemVCdWlsZERpcihidWlsZFBhdGgpIHtcbiAgICBjb25zb2xlLmxvZyhgSW5pdGlhbGl6aW5nIHRoZSBidWlsZCBkaXJlY3RvcnkgZnJvbSAke2J1aWxkUGF0aH0gLi4uYClcblxuICAgIEFwaXJWZXJzaW9uID0gKGF3YWl0IGFzeW5jX2ZzLnJlYWRGaWxlKGJ1aWxkUGF0aCArICcvc3JjX2luZm8vdmVyc2lvbi50eHQnLCAndXRmOCcpKS5yZXBsYWNlKC9cXG4kLywgXCJcIik7XG5cbiAgICBpZiAoUmFtYWxhbWFSZW1vdGluZ0ltYWdlID09PSB1bmRlZmluZWQpXG4gICAgICAgIFJhbWFsYW1hUmVtb3RpbmdJbWFnZSA9IChhd2FpdCBhc3luY19mcy5yZWFkRmlsZShidWlsZFBhdGggKyAnL3NyY19pbmZvL3JhbWFsYW1hLmltYWdlLWluZm8udHh0JywgJ3V0ZjgnKSkucmVwbGFjZSgvXFxuJC8sIFwiXCIpO1xufVxuXG5hc3luYyBmdW5jdGlvbiBpbml0aWFsaXplU3RvcmFnZURpcihzdG9yYWdlUGF0aCwgYnVpbGRQYXRoKSB7XG4gICAgY29uc29sZS5sb2coYEluaXRpYWxpemluZyB0aGUgc3RvcmFnZSBkaXJlY3RvcnkgLi4uYClcblxuICAgIGlmICghZnMuZXhpc3RzU3luYyhzdG9yYWdlUGF0aCkpe1xuICAgICAgICBmcy5ta2RpclN5bmMoc3RvcmFnZVBhdGgpO1xuICAgIH1cblxuICAgIGlmIChBcGlyVmVyc2lvbiA9PT0gdW5kZWZpbmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJBUElSIHZlcnNpb24gbm90IGxvYWRlZC4gVGhpcyBpcyB1bmV4cGVjdGVkLlwiKTtcblxuICAgIExvY2FsQnVpbGREaXIgPSBgJHtzdG9yYWdlUGF0aH0vJHtBcGlyVmVyc2lvbn1gO1xuICAgIGlmICghZnMuZXhpc3RzU3luYyhMb2NhbEJ1aWxkRGlyKSl7XG4gICAgICAgIGF3YWl0IGNvcHlSZWN1cnNpdmUoYnVpbGRQYXRoLCBMb2NhbEJ1aWxkRGlyKVxuICAgICAgICBjb25zb2xlLmxvZygnQ29weSBjb21wbGV0ZScpO1xuICAgIH1cbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGFjdGl2YXRlKGV4dGVuc2lvbkNvbnRleHQ6IGV4dGVuc2lvbkFwaS5FeHRlbnNpb25Db250ZXh0KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgLy8gaW5pdGlhbGl6ZSB0aGUgZ2xvYmFsIHZhcmlhYmxlcyAuLi5cbiAgICBFeHRlbnNpb25TdG9yYWdlUGF0aCA9IGV4dGVuc2lvbkNvbnRleHQuc3RvcmFnZVBhdGg7XG4gICAgY29uc29sZS5sb2coXCJBY3RpdmF0aW5nIHRoZSBBUEkgUmVtb3RpbmcgZXh0ZW5zaW9uIC4uLlwiKVxuXG4gICAgLy8gcmVnaXN0ZXIgdGhlIGNvbW1hbmQgcmVmZXJlbmNlZCBpbiBwYWNrYWdlLmpzb24gZmlsZVxuICAgIGNvbnN0IG1lbnVDb21tYW5kID0gZXh0ZW5zaW9uQXBpLmNvbW1hbmRzLnJlZ2lzdGVyQ29tbWFuZCgnbGxhbWEuY3BwLmFwaXIubWVudScsIGFzeW5jICgpID0+IHtcbiAgICAgICAgaWYgKEZBSUxfSUZfTk9UX01BQyAmJiAhZXh0ZW5zaW9uQXBpLmVudi5pc01hYykge1xuICAgICAgICAgICAgYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93RXJyb3JNZXNzYWdlKGBsbGFtYS5jcHAgQVBJIFJlbW90aW5nIG9ubHkgc3VwcG9ydGVkIG9uIE1hY09TLmApO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgbGV0IHN0YXR1cyA9IFwiKHN0YXR1cyBpcyB1bmRlZmluZWQpXCI7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBzdGF0dXMgPSBhd2FpdCBjaGVja1BvZG1hbk1hY2hpbmVTdGF0dXMoZmFsc2UpXG4gICAgICAgIH0gY2F0Y2ggKGVycjogdW5rbm93bikge1xuICAgICAgICAgICAgYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93RXJyb3JNZXNzYWdlKGVycik7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBtYWluX21lbnVfY2hvaWNlczogUmVjb3JkPHN0cmluZywgKCkgPT4gUHJvbWlzZTx2b2lkPiB8IHZvaWQ+ID0ge307XG4gICAgICAgIC8vIHN0YXR1cyB2YWx1ZXM6XG5cbiAgICAgICAgLy8gIDAgPT0+IHJ1bm5pbmcgd2l0aCBBUEkgUmVtb3Rpbmcgc3VwcG9ydFxuICAgICAgICAvLyAxMCA9PT4gcnVubmluZyB2ZmtpdCBWTSBpbnN0ZWFkIG9mIGtydW5raXRcbiAgICAgICAgLy8gMTEgPT0+IGtydW5raXQgbm90IHJ1bm5pbmdcbiAgICAgICAgLy8gMTIgPT0+IGtydW5raXQgcnVubmluZyB3aXRob3V0IEFQSSBSZW1vdGluZ1xuICAgICAgICAvLyAyeCA9PT4gc2NyaXB0IGNhbm5vdCBydW4gY29ycmVjdGx5XG5cbiAgICAgICAgLy8gIDEgPT0+IHJ1bm5pbmcgd2l0aCBhIGNvbnRhaW5lciBsYXVuY2hlZFxuICAgICAgICAvLzEyNyA9PT4gQVBJUiBmaWxlcyBub3QgYXZhaWxhYmxlXG5cbiAgICAgICAgbGV0IHN0YXR1c19zdHI7XG4gICAgICAgIGlmIChzdGF0dXMgPT09IDEyNykgeyAvLyBmaWxlcyBoYXZlIGJlZW4gdW5pbnN0YWxsZWRcbiAgICAgICAgICAgIHN0YXR1c19zdHIgPSBcIkFQSSBSZW1vdGluZyBiaW5hcmllcyBhcmUgbm90IGluc3RhbGxlZFwiXG4gICAgICAgICAgICBtYWluX21lbnVfY2hvaWNlc1tcIlJlaW5zdGFsbCB0aGUgQVBJIFJlbW90aW5nIGJpbmFyaWVzXCJdID0gaW5zdGFsbEFwaXJCaW5hcmllcztcblxuICAgICAgICB9IGVsc2UgaWYgKHN0YXR1cyA9PT0gMCB8fCBzdGF0dXMgPT09IDEpIHsgLy8gcnVubmluZyB3aXRoIEFQSSBSZW1vdGluZyBzdXBwb3J0XG4gICAgICAgICAgICBpZiAoc3RhdHVzID09PSAwKSB7XG4gICAgICAgICAgICAgICAgc3RhdHVzX3N0ciA9IFwiVk0gaXMgcnVubmluZyB3aXRoIEFQSSBSZW1vdGluZyDwn46JXCJcbiAgICAgICAgICAgICAgICBtYWluX21lbnVfY2hvaWNlc1tcIkxhdW5jaCBhbiBBUEkgUmVtb3RpbmcgYWNjZWxlcmF0ZWQgSW5mZXJlbmNlIFNlcnZlclwiXSA9IGxhdW5jaEFwaXJJbmZlcmVuY2VTZXJ2ZXI7XG4gICAgICAgICAgICAgICAgbWFpbl9tZW51X2Nob2ljZXNbXCJTaG93IFJhbWFMYW1hIG1vZGVsIGxhdW5jaCBjb21tYW5kXCJdID0gc2hvd1JhbWFsYW1hUnVuO1xuICAgICAgICAgICAgICAgIG1haW5fbWVudV9jaG9pY2VzW1wiU2hvdyBSYW1hTGFtYSBiZW5jaG1hcmsgY29tbWFuZHNcIl0gPSBzaG93UmFtYWxhbWFCZW5jaG1hcms7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHN0YXR1c19zdHIgPSBcImFuIEFQSSBSZW1vdGluZyBpbmZlcmVuY2Ugc2VydmVyIGlzIGFscmVhZHkgcnVubmluZ1wiXG4gICAgICAgICAgICAgICAgbWFpbl9tZW51X2Nob2ljZXNbXCJTaG93IFJhbWFMYW1hIGNoYXQgY29tbWFuZFwiXSA9IHNob3dSYW1hbGFtYUNoYXQ7XG4gICAgICAgICAgICAgICAgbWFpbl9tZW51X2Nob2ljZXNbXCJTdG9wIHRoZSBBUEkgUmVtb3RpbmcgSW5mZXJlbmNlIFNlcnZlclwiXSA9IHN0b3BBcGlySW5mZXJlbmNlU2VydmVyO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgbWFpbl9tZW51X2Nob2ljZXNbXCItLS1cIl0gPSBmdW5jdGlvbigpIHt9O1xuICAgICAgICAgICAgbWFpbl9tZW51X2Nob2ljZXNbXCJSZXN0YXJ0IFBvZE1hbiBNYWNoaW5lIHdpdGhvdXQgQVBJIFJlbW90aW5nXCJdID0gcmVzdGFydF9wb2RtYW5fbWFjaGluZV93aXRob3V0X2FwaXI7XG5cbiAgICAgICAgfSBlbHNlIGlmIChzdGF0dXMgPT09IDEwIHx8IHN0YXR1cyA9PT0gMTEgfHwgc3RhdHVzID09PSAxMikge1xuICAgICAgICAgICAgaWYgKHN0YXR1cyA9PT0gMTApIHtcbiAgICAgICAgICAgICAgICBzdGF0dXNfc3RyID0gXCJWTSBpcyBydW5uaW5nIHdpdGggdmZraXRcIjtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoc3RhdHVzID09PSAxMSkge1xuICAgICAgICAgICAgICAgIHN0YXR1c19zdHIgPSBcIlZNIGlzIG5vdCBydW5uaW5nXCI7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKHN0YXR1cyA9PT0gMTIpIHtcbiAgICAgICAgICAgICAgICBzdGF0dXNfc3RyID0gXCJWTSBpcyBydW5uaW5nIHdpdGhvdXQgQVBJIFJlbW90aW5nXCI7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBtYWluX21lbnVfY2hvaWNlc1tcIlJlc3RhcnQgUG9kTWFuIE1hY2hpbmUgd2l0aCBBUEkgUmVtb3Rpbmcgc3VwcG9ydFwiXSA9IHJlc3RhcnRfcG9kbWFuX21hY2hpbmVfd2l0aF9hcGlyO1xuICAgICAgICAgICAgbWFpbl9tZW51X2Nob2ljZXNbXCJVbmluc3RhbGwgdGhlIEFQSSBSZW1vdGluZyBiaW5hcmllc1wiXSA9IHVuaW5zdGFsbEFwaXJCaW5hcmllcztcbiAgICAgICAgfVxuXG4gICAgICAgIG1haW5fbWVudV9jaG9pY2VzW1wiLS0tXCJdID0gZnVuY3Rpb24oKSB7fTtcbiAgICAgICAgbWFpbl9tZW51X2Nob2ljZXNbXCJDaGVjayBQb2RNYW4gTWFjaGluZSBBUEkgUmVtb3Rpbmcgc3RhdHVzXCJdID0gKCkgPT4gY2hlY2tQb2RtYW5NYWNoaW5lU3RhdHVzKHRydWUpO1xuXG4gICAgICAgIC8vIGRpc3BsYXkgYSBjaG9pY2UgdG8gdGhlIHVzZXIgZm9yIHNlbGVjdGluZyBzb21lIHZhbHVlc1xuICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBleHRlbnNpb25BcGkud2luZG93LnNob3dRdWlja1BpY2soT2JqZWN0LmtleXMobWFpbl9tZW51X2Nob2ljZXMpLCB7XG4gICAgICAgICAgICB0aXRsZTogYFdoYXQgZG9cbnlvdSB3YW50IHRvIGRvPyAoJHtzdGF0dXNfc3RyfSlgLFxuICAgICAgICAgICAgY2FuUGlja01hbnk6IGZhbHNlLCAvLyB1c2VyIGNhbiBzZWxlY3QgbW9yZSB0aGFuIG9uZSBjaG9pY2VcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaWYgKHJlc3VsdCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZyhcIk5vIHVzZXIgY2hvaWNlLCBhYm9ydGluZy5cIik7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICB0cnkge1xuICAgICAgICAgICAgYXdhaXQgbWFpbl9tZW51X2Nob2ljZXNbcmVzdWx0XSgpO1xuICAgICAgICB9IGNhdGNoIChlcnI6IHVua25vd24pIHtcbiAgICAgICAgICAgIGNvbnN0IG1zZyA9IGBUYXNrIGZhaWxlZDogJHtTdHJpbmcoZXJyKX1gO1xuICAgICAgICAgICAgY29uc29sZS5lcnJvcihtc2cpO1xuICAgICAgICAgICAgYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93RXJyb3JNZXNzYWdlKG1zZyk7XG5cbiAgICAgICAgICAgIHRocm93IGVycjtcbiAgICAgICAgfVxuICAgIH0pO1xuXG4gICAgdHJ5IHtcbiAgICAgICAgLy8gY3JlYXRlIGFuIGl0ZW0gaW4gdGhlIHN0YXR1cyBiYXIgdG8gcnVuIG91ciBjb21tYW5kXG4gICAgICAgIC8vIGl0IHdpbGwgc3RpY2sgb24gdGhlIGxlZnQgb2YgdGhlIHN0YXR1cyBiYXJcbiAgICAgICAgU3RhdHVzQmFyID0gZXh0ZW5zaW9uQXBpLndpbmRvdy5jcmVhdGVTdGF0dXNCYXJJdGVtKGV4dGVuc2lvbkFwaS5TdGF0dXNCYXJBbGlnbkxlZnQsIDEwMCk7XG5cbiAgICAgICAgc2V0U3RhdHVzKFwi4pqZ77iPIEluaXRpYWxpemluZyAuLi5cIik7XG4gICAgICAgIFN0YXR1c0Jhci5jb21tYW5kID0gJ2xsYW1hLmNwcC5hcGlyLm1lbnUnO1xuICAgICAgICBTdGF0dXNCYXIuc2hvdygpO1xuXG4gICAgICAgIC8vIHJlZ2lzdGVyIGRpc3Bvc2FibGUgcmVzb3VyY2VzIHRvIGl0J3MgcmVtb3ZlZCB3aGVuIHlvdSBkZWFjdGl2dGUgdGhlIGV4dGVuc2lvblxuICAgICAgICBleHRlbnNpb25Db250ZXh0LnN1YnNjcmlwdGlvbnMucHVzaChtZW51Q29tbWFuZCk7XG4gICAgICAgIGV4dGVuc2lvbkNvbnRleHQuc3Vic2NyaXB0aW9ucy5wdXNoKFN0YXR1c0Jhcik7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc3QgbXNnID0gYENvdWxkbid0IHN1YnNjcmliZSB0aGUgZXh0ZW5zaW9uIHRvIFBvZG1hbiBEZXNrdG9wOiAke2Vycm9yfWBcblxuICAgICAgICBhd2FpdCBleHRlbnNpb25BcGkud2luZG93LnNob3dFcnJvck1lc3NhZ2UobXNnKTtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKG1zZyk7XG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgICAgc2V0U3RhdHVzKFwiSW5zdGFsbGluZyAuLi5cIilcbiAgICAgICAgYXdhaXQgaW5zdGFsbEFwaXJCaW5hcmllcygpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIHJldHVybjsgLy8gbWVzc2FnZSBhbHJlYWR5IHByaW50ZWQgb24gc2NyZWVuXG4gICAgfVxuXG4gICAgc2V0U3RhdHVzKGDimpnvuI8gTG9hZGluZyB0aGUgbW9kZWxzIC4uLmApO1xuICAgIHRyeSB7XG4gICAgICAgIHJlZnJlc2hBdmFpbGFibGVNb2RlbHMoKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zdCBtc2cgPSBgQ291bGRuJ3QgaW5pdGlhbGl6ZSB0aGUgZXh0ZW5zaW9uOiAke2Vycm9yfWBcblxuICAgICAgICBhd2FpdCBleHRlbnNpb25BcGkud2luZG93LnNob3dFcnJvck1lc3NhZ2UobXNnKTtcbiAgICAgICAgc2V0U3RhdHVzKGDwn5S0ICR7bXNnfWApO1xuICAgICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBzZXRTdGF0dXMoKTtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGRlYWN0aXZhdGUoKTogUHJvbWlzZTx2b2lkPiB7XG5cbn1cblxuYXN5bmMgZnVuY3Rpb24gaW5zdGFsbEFwaXJCaW5hcmllcygpIHtcbiAgICB0cnkge1xuICAgICAgICBhd2FpdCBpbml0aWFsaXplQnVpbGREaXIoRVhURU5TSU9OX0JVSUxEX1BBVEgpO1xuICAgICAgICBjb25zb2xlLmxvZyhgSW5zdGFsbGluZyBBUElSIHZlcnNpb24gJHtBcGlyVmVyc2lvbn0gLi4uYCk7XG4gICAgICAgIFN0YXR1c0Jhci50b29sdGlwID0gYHZlcnNpb24gJHtBcGlyVmVyc2lvbn1gO1xuICAgICAgICBjb25zb2xlLmxvZyhgVXNpbmcgaW1hZ2UgJHtSYW1hbGFtYVJlbW90aW5nSW1hZ2V9YCk7XG5cbiAgICAgICAgc2V0U3RhdHVzKGDimpnvuI8gRXh0cmFjdGluZyB0aGUgYmluYXJpZXMgLi4uYCk7XG4gICAgICAgIGF3YWl0IGluaXRpYWxpemVTdG9yYWdlRGlyKEV4dGVuc2lvblN0b3JhZ2VQYXRoLCBFWFRFTlNJT05fQlVJTERfUEFUSCk7XG5cbiAgICAgICAgc2V0U3RhdHVzKGDimpnvuI8gUHJlcGFyaW5nIGtydW5raXQgLi4uYCk7XG4gICAgICAgIGF3YWl0IHByZXBhcmVfa3J1bmtpdCgpO1xuICAgICAgICBzZXRTdGF0dXMoYOKchSBiaW5hcmllcyBpbnN0YWxsZWRgKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zdCBtc2cgPSBgQ291bGRuJ3QgaW5pdGlhbGl6ZSB0aGUgZXh0ZW5zaW9uOiAke2Vycm9yfWBcbiAgICAgICAgc2V0U3RhdHVzKGDwn5S0ICR7bXNnfWApO1xuICAgICAgICBhd2FpdCBleHRlbnNpb25BcGkud2luZG93LnNob3dFcnJvck1lc3NhZ2UobXNnKTtcbiAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiB1bmluc3RhbGxBcGlyQmluYXJpZXMoKSB7XG4gICAgaWYgKEV4dGVuc2lvblN0b3JhZ2VQYXRoID09PSB1bmRlZmluZWQpIHRocm93IG5ldyBFcnJvcignRXh0ZW5zaW9uU3RvcmFnZVBhdGggbm90IGRlZmluZWQgOi8nKTtcbiAgICBzZXRTdGF0dXMoYOKame+4jyBVbmluc3RhbGxpbmcgdGhlIGJpbmFyaWVzIC4uLmApO1xuICAgIGNvbnN0IHRvRGVsZXRlID0gW107XG5cbiAgICByZWdpc3RlckZyb21EaXIoRXh0ZW5zaW9uU3RvcmFnZVBhdGgsICdjaGVja19wb2RtYW5fbWFjaGluZV9zdGF0dXMuc2gnLCBmdW5jdGlvbihmaWxlbmFtZSkge3RvRGVsZXRlLnB1c2gocGF0aC5kaXJuYW1lKGZpbGVuYW1lKSl9KTtcblxuICAgIGZvciAoY29uc3QgZGlyTmFtZSBvZiB0b0RlbGV0ZSkge1xuICAgICAgICBjb25zb2xlLndhcm4oXCLimqDvuI8gZGVsZXRpbmcgQVBJUiBkaXJlY3Rvcnk6IFwiLCBkaXJOYW1lKTtcblxuICAgICAgICBmcy5ybVN5bmMoZGlyTmFtZSwgeyByZWN1cnNpdmU6IHRydWUsIGZvcmNlOiB0cnVlIH0pO1xuICAgIH1cbiAgICBjb25zb2xlLndhcm4oXCLimqDvuI8gZGVsZXRpbmcgZG9uZVwiKTtcblxuICAgIHNldFN0YXR1cyhg4pyFIGJpbmFyaWVzIHVuaW5zdGFsbGVkIPCfkYtgKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZ2V0Q29ubmVjdGlvbk5hbWUoYWxsb3dVbmRlZmluZWQgPSBmYWxzZSk6IFByb21pc2U8c3RyaW5nIHwgdW5kZWZpbmVkPiB7XG4gICAgdHJ5IHtcbiAgICAgICAgY29uc3QgY29ubmVjdGlvbiA9IGdldENvbm5lY3Rpb24oYWxsb3dVbmRlZmluZWQpO1xuICAgICAgICBjb25zdCBjb25uZWN0aW9uTmFtZSA9IGNvbm5lY3Rpb24/LltcIm5hbWVcIl07XG5cbiAgICAgICAgaWYgKCFhbGxvd1VuZGVmaW5lZCAmJiBjb25uZWN0aW9uTmFtZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ2Nhbm5vdCBmaW5kIHBvZG1hbiBjb25uZWN0aW9uIG5hbWUnKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoY29ubmVjdGlvbk5hbWUpIHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKFwiQ29ubmVjdGluZyB0b1wiLCBjb25uZWN0aW9uTmFtZSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGNvbm5lY3Rpb25OYW1lO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnN0IG1zZyA9IGBGYWlsZWQgdG8gZ2V0IHRoZSBkZWZhdWx0IGNvbm5lY3Rpb24gdG8gUG9kbWFuOiAke2Vycm9yfWBcbiAgICAgICAgYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93RXJyb3JNZXNzYWdlKG1zZyk7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IobXNnKTtcbiAgICAgICAgc2V0U3RhdHVzKGDwn5S0ICR7bXNnfWApO1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IobXNnKTtcbiAgICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJlc3RhcnRfcG9kbWFuX21hY2hpbmVfd2l0aF9hcGlyKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmIChMb2NhbEJ1aWxkRGlyID09PSB1bmRlZmluZWQpIHRocm93IG5ldyBFcnJvcihcIkxvY2FsQnVpbGREaXIgbm90IGxvYWRlZC4gVGhpcyBpcyB1bmV4cGVjdGVkLlwiKTtcblxuICAgIGNvbnN0IGNvbm5lY3Rpb25OYW1lID0gYXdhaXQgZ2V0Q29ubmVjdGlvbk5hbWUodHJ1ZSk7XG5cbiAgICB0cnkge1xuICAgICAgICBzZXRTdGF0dXMoXCLimpnvuI8gUmVzdGFydGluZyBQb2RNYW4gTWFjaGluZSB3aXRoIEFQSSBSZW1vdGluZyBzdXBwb3J0IC4uLlwiKVxuICAgICAgICBjb25zdCBhcmdzID0gW1wiYmFzaFwiLCBgJHtMb2NhbEJ1aWxkRGlyfS9wb2RtYW5fc3RhcnRfbWFjaGluZS5hcGlfcmVtb3Rpbmcuc2hgXTtcbiAgICAgICAgaWYgKGNvbm5lY3Rpb25OYW1lICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIGFyZ3MucHVzaChjb25uZWN0aW9uTmFtZSk7XG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgVXNpbmcgY29ubmVjdGlvbiAke2Nvbm5lY3Rpb25OYW1lfWApO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgY29uc29sZS5sb2coYFVzaW5nIHRoZSBkZWZhdWx0IGNvbm5lY3Rpb25gKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHsgc3Rkb3V0IH0gPSBhd2FpdCBleHRlbnNpb25BcGkucHJvY2Vzcy5leGVjKFwiL3Vzci9iaW4vZW52XCIsIGFyZ3MsIHtjd2Q6IExvY2FsQnVpbGREaXJ9KTtcblxuICAgICAgICBjb25zdCBtc2cgPSBcIvCfn6IgUG9kTWFuIE1hY2hpbmUgc3VjY2Vzc2Z1bGx5IHJlc3RhcnRlZCB3aXRoIEFQSSBSZW1vdGluZyBzdXBwb3J0XCJcbiAgICAgICAgYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93SW5mb3JtYXRpb25NZXNzYWdlKG1zZyk7XG4gICAgICAgIGNvbnNvbGUubG9nKG1zZyk7XG4gICAgICAgIHNldFN0YXR1cyhcIvCfn6IgQVBJIFJlbW90aW5nIHN1cHBvcnQgZW5hYmxlZFwiKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zdCBtc2cgPSBgRmFpbGVkIHRvIHJlc3RhcnQgUG9kTWFuIE1hY2hpbmUgd2l0aCB0aGUgQVBJIFJlbW90aW5nIHN1cHBvcnQ6ICR7ZXJyb3J9YFxuICAgICAgICBhd2FpdCBleHRlbnNpb25BcGkud2luZG93LnNob3dFcnJvck1lc3NhZ2UobXNnKTtcbiAgICAgICAgY29uc29sZS5lcnJvcihtc2cpO1xuICAgICAgICBzZXRTdGF0dXMoYPCflLQgJHttc2d9YCk7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihtc2cpO1xuICAgIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gcmVzdGFydF9wb2RtYW5fbWFjaGluZV93aXRob3V0X2FwaXIoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgY29ubmVjdGlvbk5hbWUgPSBhd2FpdCBnZXRDb25uZWN0aW9uTmFtZSgpO1xuXG4gICAgdHJ5IHtcbiAgICAgICAgc2V0U3RhdHVzKFwi4pqZ77iPIFN0b3BwaW5nIHRoZSBQb2RNYW4gTWFjaGluZSAuLi5cIilcbiAgICAgICAgY29uc3QgeyBzdGRvdXQgfSA9IGF3YWl0IGV4dGVuc2lvbkFwaS5wcm9jZXNzLmV4ZWMoXCJwb2RtYW5cIiwgWydtYWNoaW5lJywgJ3N0b3AnLCBjb25uZWN0aW9uTmFtZV0pO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnN0IG1zZyA9IGBGYWlsZWQgdG8gc3RvcCB0aGUgUG9kTWFuIE1hY2hpbmU6ICR7ZXJyb3J9YDtcbiAgICAgICAgc2V0U3RhdHVzKGDwn5S0ICR7bXNnfWApO1xuICAgICAgICBhd2FpdCBleHRlbnNpb25BcGkud2luZG93LnNob3dFcnJvck1lc3NhZ2UobXNnKTtcbiAgICAgICAgY29uc29sZS5lcnJvcihtc2cpO1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IobXNnKTtcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgICBzZXRTdGF0dXMoXCLimpnvuI8gUmVzdGFydGluZyB0aGUgZGVmYXVsdCBQb2RNYW4gTWFjaGluZSAuLi5cIilcbiAgICAgICAgY29uc3QgeyBzdGRvdXQgfSA9IGF3YWl0IGV4dGVuc2lvbkFwaS5wcm9jZXNzLmV4ZWMoXCJwb2RtYW5cIiwgWydtYWNoaW5lJywgJ3N0YXJ0JywgY29ubmVjdGlvbk5hbWVdKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zdCBtc2cgPSBgRmFpbGVkIHRvIHJlc3RhcnQgdGhlIFBvZE1hbiBNYWNoaW5lOiAke2Vycm9yfWA7XG4gICAgICAgIHNldFN0YXR1cyhg8J+UtCAke21zZ31gKTtcbiAgICAgICAgYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93RXJyb3JNZXNzYWdlKG1zZyk7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IobXNnKTtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKG1zZyk7XG4gICAgfVxuXG4gICAgY29uc3QgbXNnID0gXCJQb2RNYW4gTWFjaGluZSBzdWNjZXNzZnVsbHkgcmVzdGFydGVkIHdpdGhvdXQgQVBJIFJlbW90aW5nIHN1cHBvcnRcIjtcbiAgICBhd2FpdCBleHRlbnNpb25BcGkud2luZG93LnNob3dJbmZvcm1hdGlvbk1lc3NhZ2UobXNnKTtcbiAgICBjb25zb2xlLmxvZyhtc2cpO1xuICAgIHNldFN0YXR1cyhcIvCfn6AgUnVubmluZyB3aXRob3V0IEFQSSBSZW1vdGluZyBzdXBwb3J0XCIpXG59XG5cbmFzeW5jIGZ1bmN0aW9uIHByZXBhcmVfa3J1bmtpdCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoTG9jYWxCdWlsZERpciA9PT0gdW5kZWZpbmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJMb2NhbEJ1aWxkRGlyIG5vdCBsb2FkZWQuIFRoaXMgaXMgdW5leHBlY3RlZC5cIik7XG5cbiAgICBpZiAoZnMuZXhpc3RzU3luYyhgJHtMb2NhbEJ1aWxkRGlyfS9iaW4va3J1bmtpdGApKSB7XG4gICAgICAgIGNvbnNvbGUubG9nKFwiQmluYXJpZXMgYWxyZWFkeSBwcmVwYXJlZC5cIilcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHNldFN0YXR1cyhg4pqZ77iPIFByZXBhcmluZyB0aGUga3J1bmtpdCBiaW5hcmllcyBmb3IgQVBJIFJlbW90aW5nIC4uLmApO1xuICAgIGlmICghZnMuZXhpc3RzU3luYyhgJHtMb2NhbEJ1aWxkRGlyfS91cGRhdGVfa3J1bmtpdC5zaGApKSB7XG4gICAgICAgIGNvbnN0IG1zZyA9IGBDYW5ub3QgcHJlcGFyZSB0aGUga3J1bmtpdCBiaW5hcmllczogJHtMb2NhbEJ1aWxkRGlyfS91cGRhdGVfa3J1bmtpdC5zaCBkb2VzIG5vdCBleGlzdGBcbiAgICAgICAgY29uc29sZS5lcnJvcihtc2cpO1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IobXNnKTtcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgICBjb25zdCB7IHN0ZG91dCB9ID0gYXdhaXQgZXh0ZW5zaW9uQXBpLnByb2Nlc3MuZXhlYyhcIi91c3IvYmluL2VudlwiLCBbXCJiYXNoXCIsIGAke0xvY2FsQnVpbGREaXJ9L3VwZGF0ZV9rcnVua2l0LnNoYF0sIHtjd2Q6IExvY2FsQnVpbGREaXJ9KTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zb2xlLmVycm9yKGVycm9yKTtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBDb3VsZG4ndCB1cGRhdGUgdGhlIGtydW5raXQgYmluYXJpZXM6ICR7ZXJyb3J9OiAke2Vycm9yLnN0ZG91dH1gKTtcbiAgICB9XG4gICAgc2V0U3RhdHVzKGDinIUgYmluYXJpZXMgcHJlcGFyZWQhYCk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGNoZWNrUG9kbWFuTWFjaGluZVN0YXR1cyh3aXRoX2d1aTogYm9vbGVhbik6IFByb21pc2U8bnVtYmVyPiB7XG4gICAgaWYgKCFmcy5leGlzdHNTeW5jKGAke0xvY2FsQnVpbGREaXJ9L2NoZWNrX3BvZG1hbl9tYWNoaW5lX3N0YXR1cy5zaGApKSB7XG4gICAgICAgIGNvbnNvbGUubG9nKGBjaGVja1BvZG1hbk1hY2hpbmVTdGF0dXM6IHNjcmlwdCBub3QgZm91bmQgaW4gJHtMb2NhbEJ1aWxkRGlyfWApXG4gICAgICAgIHNldFN0YXR1cyhcIuKblCBub3QgaW5zdGFsbGVkXCIpO1xuICAgICAgICBpZiAod2l0aF9ndWkpIHtcbiAgICAgICAgICAgIGF3YWl0IGV4dGVuc2lvbkFwaS53aW5kb3cuc2hvd0luZm9ybWF0aW9uTWVzc2FnZShcIuKblCBBUEkgUmVtb3RpbmcgYmluYXJpZXMgYXJlIG5vdCBpbnN0YWxsZWRcIik7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIDEyNztcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgICBjb25zdCB7IHN0ZG91dCB9ID0gYXdhaXQgZXh0ZW5zaW9uQXBpLnByb2Nlc3MuZXhlYyhcIi91c3IvYmluL2VudlwiLCBbXCJiYXNoXCIsIGAke0xvY2FsQnVpbGREaXJ9L2NoZWNrX3BvZG1hbl9tYWNoaW5lX3N0YXR1cy5zaGBdLCB7Y3dkOiBMb2NhbEJ1aWxkRGlyfSk7XG4gICAgICAgIC8vIGV4aXQgd2l0aCBzdWNjZXNzLCBrcnVua2l0IGlzIHJ1bm5pbmcgQVBJIHJlbW90aW5nXG4gICAgICAgIGNvbnN0IHN0YXR1cyA9IHN0ZG91dC5yZXBsYWNlKC9cXG4kLywgXCJcIilcbiAgICAgICAgY29uc3QgbXNnID0gYFBvZG1hbiBNYWNoaW5lIEFQSSBSZW1vdGluZyBzdGF0dXM6XFxuJHtzdGF0dXN9YFxuICAgICAgICBpZiAod2l0aF9ndWkpIHtcbiAgICAgICAgICAgIGF3YWl0IGV4dGVuc2lvbkFwaS53aW5kb3cuc2hvd0luZm9ybWF0aW9uTWVzc2FnZShtc2cpO1xuICAgICAgICB9XG4gICAgICAgIGNvbnNvbGUubG9nKG1zZyk7XG4gICAgICAgIGNvbnN0IGNvbnRhaW5lckluZm8gPSBhd2FpdCBoYXNBcGlyQ29udGFpbmVyUnVubmluZygpO1xuICAgICAgICBpZiAoY29udGFpbmVySW5mbyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBzZXRTdGF0dXMoYPCfn6IgSW5mZXJlbmNlIFNlcnZlciBydW5uaW5nYCk7XG4gICAgICAgICAgICByZXR1cm4gMTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHNldFN0YXR1cyhcIvCfn6JcIik7XG4gICAgICAgICAgICByZXR1cm4gMDtcbiAgICAgICAgfVxuXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgbGV0IG1zZztcbiAgICAgICAgY29uc3Qgc3RhdHVzID0gZXJyb3Iuc3Rkb3V0LnJlcGxhY2UoL1xcbiQvLCBcIlwiKVxuICAgICAgICBjb25zdCBleGl0Q29kZSA9IGVycm9yLmV4aXRDb2RlO1xuXG4gICAgICAgIGlmIChleGl0Q29kZSA+IDEwICYmIGV4aXRDb2RlIDwgMjApIHtcbiAgICAgICAgICAgIC8vIGV4aXQgd2l0aCBjb2RlIDF4ID09PiBzdWNjZXNzZnVsIGNvbXBsZXRpb24sIGJ1dCBub3QgQVBJIFJlbW90aW5nIHN1cHBvcnRcbiAgICAgICAgICAgIG1zZyA9YPCfn6AgUG9kbWFuIE1hY2hpbmUgc3RhdHVzOiAke3N0YXR1c31gO1xuICAgICAgICAgICAgaWYgKHdpdGhfZ3VpKSB7XG4gICAgICAgICAgICAgICAgYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93SW5mb3JtYXRpb25NZXNzYWdlKG1zZyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjb25zb2xlLndhcm4obXNnKVxuICAgICAgICAgICAgaWYgKGV4aXRDb2RlID09PSAxMCB8fCBleGl0Q29kZSA9PT0gMTIpIHtcbiAgICAgICAgICAgICAgICBzZXRTdGF0dXMoXCLwn5+gIFBvZE1hbiBNYWNoaW5lIHJ1bm5pbmcgd2l0aG91dCBBUEkgUmVtb3Rpbmcgc3VwcG9ydFwiKTtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoZXhpdENvZGUgPT09IDExKSB7XG4gICAgICAgICAgICAgICAgc2V0U3RhdHVzKFwi8J+foCBQb2RNYW4gTWFjaGluZSBub3QgcnVubmluZ1wiKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgc2V0U3RhdHVzKGDwn5S0IEludmFsaWQgY2hlY2sgc3RhdHVzICR7ZXhpdENvZGV9YClcbiAgICAgICAgICAgICAgICBjb25zb2xlLndhcm4oYEludmFsaWQgY2hlY2sgc3RhdHVzICR7ZXhpdENvZGV9OiAke2Vycm9yLnN0ZG91dH1gKVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByZXR1cm4gZXhpdENvZGU7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBvdGhlciBleGl0IGNvZGUgY3Jhc2ggb2YgdW5zdWNjZXNzZnVsIGNvbXBsZXRpb25cbiAgICAgICAgbXNnID1gRmFpbGVkIHRvIGNoZWNrIFBvZE1hbiBNYWNoaW5lIHN0YXR1czogJHtzdGF0dXN9IChjb2RlICMke2V4aXRDb2RlfSlgO1xuICAgICAgICBhd2FpdCBleHRlbnNpb25BcGkud2luZG93LnNob3dFcnJvck1lc3NhZ2UobXNnKTtcbiAgICAgICAgY29uc29sZS5lcnJvcihtc2cpO1xuICAgICAgICBzZXRTdGF0dXMoYPCflLQgJHttc2d9YClcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKG1zZyk7XG4gICAgfVxufVxuIl0sIm5hbWVzIjpbImNvbnRhaW5lckVuZ2luZSIsImNvbnRhaW5lckluZm8iLCJleHRlbnNpb25BcGkiLCJpZCIsInByb3ZpZGVyIiwiY29ubmVjdGlvbiIsImltYWdlSW5mbyIsIm1zZyJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQWtCTyxNQUFNLE1BQUEsR0FBaUI7QUFFOUIsTUFBTSxJQUFBLEdBQU8sUUFBUSxNQUFNLENBQUE7QUFDM0IsTUFBTSxFQUFBLEdBQUssUUFBUSxJQUFJLENBQUE7QUFDdkIsTUFBTSxRQUFBLEdBQVcsUUFBUSxhQUFhLENBQUE7QUFFdEMsTUFBTSxrQkFBa0IsRUFBQztBQUN6QixJQUFJLG9CQUFBLEdBQXVCLE1BQUE7QUFHM0IsTUFBTSxvQkFBQSxHQUF1QixJQUFBLENBQUssS0FBQSxDQUFNLFVBQVUsRUFBRSxHQUFBLEdBQU0sV0FBQTtBQUkxRCxJQUFJLHFCQUFBLEdBQXdCLE1BQUE7QUFDNUIsSUFBSSxXQUFBLEdBQWMsTUFBQTtBQUNsQixJQUFJLGFBQUEsR0FBZ0IsTUFBQTtBQUNwQixJQUFJLFNBQUEsR0FBWSxNQUFBO0FBQ2hCLElBQUksd0JBQUEsR0FBMkIsS0FBQTtBQUUvQixTQUFTLFVBQVUsTUFBQSxFQUFRO0FBQ3ZCLEVBQUEsT0FBQSxDQUFRLEdBQUEsQ0FBSSxDQUFBLHFCQUFBLEVBQXdCLE1BQU0sQ0FBQSxDQUFFLENBQUE7QUFDNUMsRUFBQSxJQUFJLGNBQWMsTUFBQSxFQUFXO0FBQ3pCLElBQUEsT0FBQSxDQUFRLEtBQUssOEJBQThCLENBQUE7QUFDM0MsSUFBQTtBQUFBLEVBQ0o7QUFDQSxFQUFBLElBQUksV0FBVyxNQUFBLEVBQVc7QUFDdEIsSUFBQSxTQUFBLENBQVUsSUFBQSxHQUFPLENBQUEsc0JBQUEsQ0FBQTtBQUFBLEVBQ3JCLENBQUEsTUFBTztBQUNILElBQUEsU0FBQSxDQUFVLElBQUEsR0FBTywyQkFBMkIsTUFBTSxDQUFBLENBQUE7QUFBQSxFQUN0RDtBQUNKO0FBRUEsU0FBUyxlQUFBLENBQWdCLFNBQUEsRUFBVyxNQUFBLEVBQVEsUUFBQSxFQUFVO0FBQ2xELEVBQUEsSUFBSSxDQUFDLEVBQUEsQ0FBRyxVQUFBLENBQVcsU0FBUyxDQUFBLEVBQUc7QUFDM0IsSUFBQSxPQUFBLENBQVEsR0FBQSxDQUFJLFdBQVcsU0FBUyxDQUFBO0FBQ2hDLElBQUE7QUFBQSxFQUNKO0FBRUEsRUFBQSxJQUFJLEtBQUEsR0FBUSxFQUFBLENBQUcsV0FBQSxDQUFZLFNBQVMsQ0FBQTtBQUNwQyxFQUFBLEtBQUEsSUFBUyxDQUFBLEdBQUksQ0FBQSxFQUFHLENBQUEsR0FBSSxLQUFBLENBQU0sUUFBUSxDQUFBLEVBQUEsRUFBSztBQUNuQyxJQUFBLElBQUksV0FBVyxJQUFBLENBQUssSUFBQSxDQUFLLFNBQUEsRUFBVyxLQUFBLENBQU0sQ0FBQyxDQUFDLENBQUE7QUFDNUMsSUFBQSxJQUFJLElBQUEsR0FBTyxFQUFBLENBQUcsU0FBQSxDQUFVLFFBQVEsQ0FBQTtBQUNoQyxJQUFBLElBQUksSUFBQSxDQUFLLGFBQVksRUFBRztBQUNwQixNQUFBLGVBQUEsQ0FBZ0IsUUFBQSxFQUFVLFFBQVEsUUFBUSxDQUFBO0FBQUEsSUFDOUMsQ0FBQSxNQUFBLElBQVcsUUFBQSxDQUFTLFFBQUEsQ0FBUyxNQUFNLENBQUEsRUFBRztBQUNsQyxNQUFBLFFBQUEsQ0FBUyxRQUFRLENBQUE7QUFBQSxJQUNyQjtBQUFDLEVBQ0w7QUFDSjtBQUdBLGVBQWUsYUFBQSxDQUFjLEtBQUssSUFBQSxFQUFNO0FBQ3BDLEVBQUEsTUFBTSxPQUFBLEdBQVUsTUFBTSxRQUFBLENBQVMsT0FBQSxDQUFRLEtBQUssRUFBRSxhQUFBLEVBQWUsTUFBTSxDQUFBO0FBRW5FLEVBQUEsTUFBTSxTQUFTLEtBQUEsQ0FBTSxJQUFBLEVBQU0sRUFBRSxTQUFBLEVBQVcsTUFBTSxDQUFBO0FBRTlDLEVBQUEsS0FBQSxJQUFTLFNBQVMsT0FBQSxFQUFTO0FBQ3ZCLElBQUEsTUFBTSxPQUFBLEdBQVUsSUFBQSxDQUFLLElBQUEsQ0FBSyxHQUFBLEVBQUssTUFBTSxJQUFJLENBQUE7QUFDekMsSUFBQSxNQUFNLFFBQUEsR0FBVyxJQUFBLENBQUssSUFBQSxDQUFLLElBQUEsRUFBTSxNQUFNLElBQUksQ0FBQTtBQUUzQyxJQUFBLElBQUksS0FBQSxDQUFNLGFBQVksRUFBRztBQUNyQixNQUFBLE1BQU0sYUFBQSxDQUFjLFNBQVMsUUFBUSxDQUFBO0FBQUEsSUFDekMsQ0FBQSxNQUFPO0FBQ0gsTUFBQSxNQUFNLFFBQUEsQ0FBUyxRQUFBLENBQVMsT0FBQSxFQUFTLFFBQVEsQ0FBQTtBQUFBLElBQzdDO0FBQUEsRUFDSjtBQUNKO0FBRUEsTUFBTSxrQkFBa0IsTUFBYztBQUVsQyxFQUFBLE9BQUEsQ0FBUSxJQUFBLENBQUssUUFBTyxHQUFJLENBQUEsRUFBRyxTQUFTLEVBQUUsQ0FBQSxDQUFFLFVBQVUsQ0FBQyxDQUFBO0FBQ3ZELENBQUE7QUFFQSxTQUFTLHNCQUFBLEdBQXlCO0FBTTlCLEVBQUEsSUFBSSxvQkFBQSxLQUF5QixNQUFBLEVBQVcsTUFBTSxJQUFJLE1BQU0scUNBQXFDLENBQUE7QUFHN0YsRUFBQSxNQUFBLENBQU8sSUFBQSxDQUFLLGVBQWUsQ0FBQSxDQUFFLE9BQUEsQ0FBUSxTQUFPLE9BQU8sZUFBQSxDQUFnQixHQUFHLENBQUMsQ0FBQTtBQUV2RSxFQUFBLE1BQU0sYUFBQSxHQUFnQixTQUFTLFFBQUEsRUFBVTtBQUNyQyxJQUFBLE1BQU0sV0FBVyxRQUFBLENBQVMsS0FBQSxDQUFNLEdBQUcsQ0FBQSxDQUFFLEdBQUcsRUFBRSxDQUFBO0FBQzFDLElBQUEsTUFBTSxVQUFBLEdBQWEsUUFBQSxDQUFTLEtBQUEsQ0FBTSxHQUFHLENBQUE7QUFFckMsSUFBQSxNQUFNLFNBQUEsR0FBWSxVQUFBLENBQVcsRUFBQSxDQUFHLENBQUMsQ0FBQTtBQUNqQyxJQUFBLE1BQU0sYUFBYSxVQUFBLENBQVcsS0FBQSxDQUFNLENBQUMsQ0FBQSxDQUFFLEtBQUssR0FBRyxDQUFBO0FBQy9DLElBQUEsTUFBTSxlQUFBLEdBQWtCLENBQUEsRUFBRyxTQUFTLENBQUEsQ0FBQSxFQUFJLFVBQVUsQ0FBQSxDQUFBO0FBQ2xELElBQUEsZUFBQSxDQUFnQixlQUFlLENBQUEsR0FBSSxRQUFBO0FBQ25DLElBQUEsT0FBQSxDQUFRLEdBQUEsQ0FBSSxDQUFBLE1BQUEsRUFBUyxlQUFlLENBQUEsQ0FBRSxDQUFBO0FBQUEsRUFDMUMsQ0FBQTtBQUVBLEVBQUEsZUFBQSxDQUFnQixvQkFBQSxHQUF1QiwwQkFBQSxFQUE0QixPQUFBLEVBQVMsYUFBYSxDQUFBO0FBQzdGO0FBTUEsZUFBZSx1QkFBQSxHQUEwQjtBQUNyQyxFQUFBLE1BQU0sYUFBQSxHQUFBLENBQWlCLE1BQU1BLDRCQUFBLENBQWdCLGNBQUEsRUFBZSxFQUFHLElBQUE7QUFBQSxJQUMzRCxDQUFBQyxtQkFDQUEsY0FBQUEsQ0FBYyxNQUFBLEdBQVMsZ0JBQWdCLENBQUEsS0FBTSxNQUFBLElBQ3pDQSxlQUFjLEtBQUEsS0FBVTtBQUFBLEdBQ2hDO0FBRUEsRUFBQSxPQUFPLGFBQUE7QUFDWDtBQUVBLGVBQWUsdUJBQUEsR0FBMEI7QUFDckMsRUFBQSxNQUFNLGFBQUEsR0FBZ0IsTUFBTSx1QkFBQSxFQUF3QjtBQUNwRCxFQUFBLElBQUksa0JBQWtCLE1BQUEsRUFBVztBQUM3QixJQUFBLE1BQU0sR0FBQSxHQUFNLENBQUEsdURBQUEsQ0FBQTtBQUNaLElBQUEsU0FBQSxDQUFVLEdBQUcsQ0FBQTtBQUNiLElBQUEsTUFBTUMsdUJBQUEsQ0FBYSxNQUFBLENBQU8sZ0JBQUEsQ0FBaUIsR0FBRyxDQUFBO0FBQzlDLElBQUE7QUFBQSxFQUNKO0FBQ0EsRUFBQSxTQUFBLENBQVUsc0NBQXNDLENBQUE7QUFDaEQsRUFBQSxNQUFNRiw0QkFBQSxDQUFnQixhQUFBLENBQWMsYUFBQSxDQUFjLFFBQUEsRUFBVSxjQUFjLEVBQUUsQ0FBQTtBQUM1RSxFQUFBLE1BQU0seUJBQXlCLEtBQUssQ0FBQTtBQUN4QztBQUVBLGVBQWUsZ0JBQUEsR0FBbUI7QUFDOUIsRUFBQSxNQUFNLGFBQUEsR0FBZ0IsTUFBTSx1QkFBQSxFQUF3QjtBQUNwRCxFQUFBLElBQUksa0JBQWtCLE1BQUEsRUFBVztBQUM3QixJQUFBLE1BQU0sR0FBQSxHQUFNLENBQUEsdURBQUEsQ0FBQTtBQUNaLElBQUEsU0FBQSxDQUFVLEdBQUcsQ0FBQTtBQUNiLElBQUEsTUFBTUUsdUJBQUEsQ0FBYSxNQUFBLENBQU8sZ0JBQUEsQ0FBaUIsR0FBRyxDQUFBO0FBQzlDLElBQUE7QUFBQSxFQUNKO0FBQ0EsRUFBQSxNQUFNLE9BQUEsR0FBVSxlQUFlLE1BQUEsRUFBUSxHQUFBO0FBRXZDLEVBQUEsSUFBSSxDQUFDLE9BQUEsRUFBUztBQUNWLElBQUEsTUFBTSxHQUFBLEdBQU0seURBQUE7QUFDWixJQUFBLFNBQUEsQ0FBVSxHQUFHLENBQUE7QUFDYixJQUFBLE1BQU1BLHVCQUFBLENBQWEsTUFBQSxDQUFPLGdCQUFBLENBQWlCLEdBQUcsQ0FBQTtBQUM5QyxJQUFBO0FBQUEsRUFDSjtBQUVBLEVBQUEsTUFBTUEsdUJBQUEsQ0FBYSxPQUFPLFlBQUEsQ0FBYTtBQUFBLElBQ25DLEtBQUEsRUFBTyxlQUFBO0FBQUEsSUFDUCxNQUFBLEVBQVEsc0RBQUE7QUFBQSxJQUNSLFNBQUEsRUFBVyxJQUFBO0FBQUEsSUFDWCxLQUFBLEVBQU8sd0JBQXdCLE9BQU8sQ0FBQSxDQUFBO0FBQUEsR0FDekMsQ0FBQTtBQUNMO0FBRUEsZUFBZSxlQUFBLEdBQWtCO0FBQzdCLEVBQUEsSUFBSSxDQUFDLHFCQUFBLEVBQXVCO0FBQ3hCLElBQUEsTUFBTUEsdUJBQUEsQ0FBYSxNQUFBLENBQU8sZ0JBQUEsQ0FBaUIsK0JBQStCLENBQUE7QUFDMUUsSUFBQTtBQUFBLEVBQ0o7QUFDQSxFQUFBLE1BQU1BLHVCQUFBLENBQWEsT0FBTyxZQUFBLENBQWE7QUFBQSxJQUNuQyxLQUFBLEVBQU8sY0FBQTtBQUFBLElBQ1AsTUFBQSxFQUFRLG9DQUFBO0FBQUEsSUFDUixTQUFBLEVBQVcsSUFBQTtBQUFBLElBQ1gsS0FBQSxFQUFPLHlCQUF5QixxQkFBcUIsQ0FBQSxVQUFBO0FBQUEsR0FDeEQsQ0FBQTtBQUNMO0FBRUEsZUFBZSxxQkFBQSxHQUF3QjtBQUNuQyxFQUFBLElBQUksQ0FBQyxxQkFBQSxFQUF1QjtBQUN4QixJQUFBLE1BQU1BLHVCQUFBLENBQWEsTUFBQSxDQUFPLGdCQUFBLENBQWlCLCtCQUErQixDQUFBO0FBQzFFLElBQUE7QUFBQSxFQUNKO0FBRUEsRUFBQSxNQUFNQSx1QkFBQSxDQUFhLE9BQU8sWUFBQSxDQUFhO0FBQUEsSUFDbkMsS0FBQSxFQUFPLGdCQUFBO0FBQUEsSUFDUCxNQUFBLEVBQVEscUNBQUE7QUFBQSxJQUNSLFNBQUEsRUFBVyxJQUFBO0FBQUEsSUFDWCxLQUFBLEVBQU87QUFBQTtBQUFBOztBQUFBO0FBQUE7O0FBQUE7QUFBQSx5QkFBQSxFQVFZLHFCQUFxQixDQUFBO0FBQUEseUJBQUE7QUFBQSxHQUUzQyxDQUFBO0FBQ0w7QUFFQSxlQUFlLHlCQUFBLEdBQTRCO0FBQ3ZDLEVBQUEsTUFBTSxhQUFBLEdBQWdCLE1BQU0sdUJBQUEsRUFBd0I7QUFDcEQsRUFBQSxJQUFJLGtCQUFrQixNQUFBLEVBQVc7QUFDN0IsSUFBQSxNQUFNQyxNQUFLLGFBQUEsQ0FBYyxFQUFBO0FBQ3pCLElBQUEsT0FBQSxDQUFRLEtBQUEsQ0FBTSxDQUFBLHVCQUFBLEVBQTBCQSxHQUFFLENBQUEsb0JBQUEsQ0FBc0IsQ0FBQTtBQUNoRSxJQUFBLE1BQU1ELHVCQUFBLENBQWEsTUFBQSxDQUFPLGdCQUFBLENBQWlCLENBQUEsMEJBQUEsRUFBNkJDLEdBQUUsQ0FBQSxpR0FBQSxDQUFtRyxDQUFBO0FBQzdLLElBQUE7QUFBQSxFQUNKO0FBRUEsRUFBQSxJQUFJLHFCQUFBLEtBQTBCLE1BQUEsRUFBVyxNQUFNLElBQUksTUFBTSw4REFBOEQsQ0FBQTtBQUV2SCxFQUFBLFNBQUEsQ0FBVSx5Q0FBeUMsQ0FBQTtBQUNuRCxFQUFBLElBQUksVUFBQTtBQUNKLEVBQUEsSUFBSSxNQUFBLENBQU8sSUFBQSxDQUFLLGVBQWUsQ0FBQSxDQUFFLFdBQVcsQ0FBQSxFQUFHO0FBQzNDLElBQUEsSUFBSSxDQUFDLHdCQUFBLEVBQTBCO0FBQzNCLE1BQUEsTUFBTUQsdUJBQUEsQ0FBYSxNQUFBLENBQU8sc0JBQUEsQ0FBdUIsQ0FBQSxzRkFBQSxDQUF3RixDQUFBO0FBQ3pJLE1BQUEsd0JBQUEsR0FBMkIsSUFBQTtBQUFBLElBQy9CO0FBQ0EsSUFBQSxJQUFJLElBQUEsR0FBTyxNQUFNQSx1QkFBQSxDQUFhLE1BQUEsQ0FBTyxjQUFBLENBQWU7QUFBQSxNQUNoRCxLQUFBLEVBQU8sMEJBQUE7QUFBQSxNQUNQLFNBQUEsRUFBVyxRQUFBO0FBQUEsTUFDWCxjQUFBLEVBQWdCLElBQUE7QUFBQSxNQUNoQixnQkFBQSxFQUFrQixLQUFBO0FBQUEsTUFDbEIsYUFBQSxFQUFlLEtBQUE7QUFBQSxNQUNmLE9BQUEsRUFBUyxFQUFFLGFBQUEsRUFBZSxDQUFDLE1BQU0sQ0FBQTtBQUFFLEtBQ3RDLENBQUE7QUFFRCxJQUFBLElBQUksQ0FBQyxJQUFBLElBQVEsSUFBQSxDQUFLLE1BQUEsS0FBVyxDQUFBLEVBQUc7QUFDNUIsTUFBQSxPQUFBLENBQVEsSUFBSSxpRUFBaUUsQ0FBQTtBQUM3RSxNQUFBO0FBQUEsSUFDSjtBQUNBLElBQUEsVUFBQSxHQUFhLElBQUEsQ0FBSyxDQUFDLENBQUEsQ0FBRSxNQUFBO0FBV3JCLElBQUEsSUFBSSxDQUFDLEVBQUEsQ0FBRyxVQUFBLENBQVcsVUFBVSxDQUFBLEVBQUU7QUFDM0IsTUFBQSxNQUFNLEdBQUEsR0FBTSw0Q0FBNEMsVUFBVSxDQUFBLENBQUE7QUFDbEUsTUFBQSxPQUFBLENBQVEsS0FBSyxHQUFHLENBQUE7QUFDaEIsTUFBQSxNQUFNQSx1QkFBQSxDQUFhLE1BQUEsQ0FBTyxnQkFBQSxDQUFpQixHQUFHLENBQUE7QUFDOUMsTUFBQTtBQUFBLElBQ0o7QUFBQSxFQUdKLENBQUEsTUFBTztBQUNILElBQUEsc0JBQUEsRUFBdUI7QUFHdkIsSUFBQSxVQUFBLEdBQWEsTUFBTUEsdUJBQUEsQ0FBYSxNQUFBLENBQU8sY0FBYyxNQUFBLENBQU8sSUFBQSxDQUFLLGVBQWUsQ0FBQSxFQUFHO0FBQUEsTUFDL0UsV0FBQSxFQUFhLEtBQUE7QUFBQTtBQUFBLE1BQ2IsS0FBQSxFQUFPO0FBQUEsS0FDVixDQUFBO0FBQ0QsSUFBQSxJQUFJLGVBQWUsTUFBQSxFQUFXO0FBQzFCLE1BQUEsT0FBQSxDQUFRLEtBQUsscUNBQXFDLENBQUE7QUFDbEQsTUFBQTtBQUFBLElBQ0o7QUFBQSxFQUNKO0FBSUEsRUFBQSxNQUFNLGFBQUEsR0FBZ0IsTUFBTUEsdUJBQUEsQ0FBYSxNQUFBLENBQU8sWUFBQSxDQUFhO0FBQUEsSUFDekQsS0FBQSxFQUFPLGNBQUE7QUFBQSxJQUNQLE1BQUEsRUFBUSxvQ0FBQTtBQUFBLElBQ1IsS0FBQSxFQUFPLE1BQUE7QUFBQSxJQUNQLGFBQUEsRUFBZSxDQUFDLEtBQUEsS0FBVyxRQUFBLENBQVMsT0FBTyxFQUFFLENBQUEsR0FBSSxPQUFPLEVBQUEsR0FBSztBQUFBLEdBQ2hFLENBQUE7QUFDRCxFQUFBLE1BQU0sWUFBWSxhQUFBLEdBQWdCLFFBQUEsQ0FBUyxhQUFBLEVBQWUsRUFBRSxJQUFJLE1BQUEsQ0FBTyxHQUFBO0FBRXZFLEVBQUEsSUFBSSxNQUFBLENBQU8sS0FBQSxDQUFNLFNBQVMsQ0FBQSxFQUFHO0FBQ3pCLElBQUEsT0FBQSxDQUFRLEtBQUsseUNBQXlDLENBQUE7QUFDdEQsSUFBQTtBQUFBLEVBQ0o7QUFFQSxFQUFBLFNBQUEsQ0FBVSwwQkFBMEIsQ0FBQTtBQUVwQyxFQUFBLE1BQU0sWUFBdUIsTUFBTSxTQUFBO0FBQUEsSUFDL0IscUJBRUosQ0FBQTtBQUVBLEVBQUEsU0FBQSxDQUFVLCtCQUErQixDQUFBO0FBRXpDLEVBQUEsTUFBTSxTQUFBLEdBQW9CLGVBQUEsQ0FBZ0IsVUFBVSxDQUFBLElBQUssVUFBQTtBQUV6RCxFQUFBLElBQUksU0FBQSxLQUFjLE1BQUE7QUFDZCxJQUFBLE1BQU0sSUFBSSxLQUFBLENBQU0sQ0FBQSw0Q0FBQSxFQUErQyxTQUFTLENBQUEscUJBQUEsQ0FBdUIsQ0FBQTtBQUVuRyxFQUFBLE1BQU0sY0FBQSxHQUFpQixJQUFBLENBQUssUUFBQSxDQUFTLFNBQVMsQ0FBQTtBQUM5QyxFQUFBLE1BQU0sZ0JBQWdCLElBQUEsQ0FBSyxRQUFBLENBQVMsSUFBQSxDQUFLLE9BQUEsQ0FBUSxTQUFTLENBQUMsQ0FBQTtBQUMzRCxFQUFBLE1BQU0sVUFBQSxHQUFhLFdBQVcsY0FBYyxDQUFBLENBQUE7QUFDNUMsRUFBQSxNQUFNLFdBQUEsR0FBYyxLQUFBO0FBR3BCLEVBQUEsTUFBTSxNQUFBLEdBQWlDO0FBQUEsSUFDbkMsQ0FBQyx5QkFBeUIsR0FBRyxLQUFLLFNBQUEsQ0FBVSxDQUFDLGFBQWEsQ0FBQyxDQUFBO0FBQUEsSUFDM0QsQ0FBQyxLQUFLLEdBQUcsQ0FBQSxpQkFBQSxFQUFvQixTQUFTLENBQUEsR0FBQSxDQUFBO0FBQUEsSUFDdEMsQ0FBQyxNQUFNLEdBQUcsQ0FBQSxpQkFBQSxFQUFvQixXQUFXLGFBQWEsU0FBUyxDQUFBLENBQUE7QUFBQSxJQUMvRCxDQUFDLEtBQUssR0FBRyxDQUFBLHNCQUFBLENBQUE7QUFBQSxJQUNULENBQUMsWUFBWSxHQUFHLGVBQUEsRUFBZ0I7QUFBQSxJQUNoQyxDQUFDLGdCQUFnQixHQUFHO0FBQUEsR0FDeEI7QUFJQSxFQUFBLE1BQU0sTUFBQSxHQUFzQjtBQUFBLElBQ3hCO0FBQUEsTUFDSSxNQUFBLEVBQVEsVUFBQTtBQUFBLE1BQ1IsTUFBQSxFQUFRLFNBQUE7QUFBQSxNQUNSLElBQUEsRUFBTSxNQUFBO0FBQUEsTUFDTixRQUFBLEVBQVU7QUFBQTtBQUNkLEdBQ0o7QUFHQSxFQUFBLElBQUksVUFBQSxHQUFpQyxNQUFBO0FBQ3JDLEVBQUEsSUFBSSxNQUFnQixFQUFDO0FBRXJCLEVBQUEsVUFBQSxHQUFhLDBCQUFBO0FBR2IsRUFBQSxNQUFNLE9BQWlCLENBQUMsQ0FBQSxXQUFBLEVBQWMsVUFBVSxDQUFBLENBQUEsRUFBSSxjQUFBLEVBQWdCLGFBQWEsZ0JBQWdCLENBQUE7QUFHakcsRUFBQSxNQUFNLFVBQW9CLEVBQUM7QUFDM0IsRUFBQSxPQUFBLENBQVEsSUFBQSxDQUFLO0FBQUEsSUFDVCxVQUFBLEVBQVksVUFBQTtBQUFBLElBQ1osZUFBQSxFQUFpQixVQUFBO0FBQUEsSUFDakIsaUJBQUEsRUFBbUI7QUFBQSxHQUN0QixDQUFBO0FBRUQsRUFBQSxNQUFNLGlCQUFrQyxFQUFDO0FBQ3pDLEVBQUEsY0FBQSxDQUFlLElBQUEsQ0FBSztBQUFBLElBQ2hCLFlBQUEsRUFBYyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUE7QUFBQSxJQUN0QixLQUFBLEVBQU87QUFBQTtBQUFBLEdBQ1YsQ0FBQTtBQUdELEVBQUEsTUFBTSxzQkFBQSxHQUFpRDtBQUFBLElBQ25ELE9BQU8sU0FBQSxDQUFVLEVBQUE7QUFBQSxJQUNqQixNQUFBLEVBQVEsSUFBQTtBQUFBLElBQ1IsVUFBQSxFQUFZLFVBQUE7QUFBQSxJQUNaLEdBQUEsRUFBSyxHQUFBO0FBQUEsSUFDTCxZQUFBLEVBQWMsRUFBRSxDQUFDLENBQUEsRUFBRyxTQUFTLENBQUEsSUFBQSxDQUFNLEdBQUcsRUFBQyxFQUFFO0FBQUEsSUFDekMsVUFBQSxFQUFZO0FBQUEsTUFDUixVQUFBLEVBQVksS0FBQTtBQUFBLE1BQ1osT0FBQSxFQUFTLE9BQUE7QUFBQSxNQUNULE1BQUEsRUFBUSxNQUFBO0FBQUEsTUFDUixjQUFBLEVBQWdCLGNBQUE7QUFBQSxNQUNoQixXQUFBLEVBQWEsQ0FBQyxlQUFlLENBQUE7QUFBQSxNQUM3QixZQUFBLEVBQWM7QUFBQSxRQUNWLFVBQUEsRUFBWTtBQUFBLFVBQ1I7QUFBQSxZQUNJLFFBQUEsRUFBVSxHQUFHLFNBQVMsQ0FBQTtBQUFBO0FBQzFCO0FBQ0o7QUFDSixLQUNKO0FBQUEsSUFFQSxXQUFBLEVBQWE7QUFBQTtBQUFBLE1BRVQsSUFBQSxFQUFNLENBQUMsV0FBQSxFQUFhLENBQUEsb0NBQUEsQ0FBc0MsQ0FBQTtBQUFBLE1BQzFELFVBQVUsTUFBQSxHQUFTLENBQUE7QUFBQSxNQUNuQixTQUFTLENBQUEsR0FBSTtBQUFBLEtBQ2pCO0FBQUEsSUFDQSxNQUFBLEVBQVEsTUFBQTtBQUFBLElBQ1IsR0FBQSxFQUFLO0FBQUEsR0FDVDtBQUNBLEVBQUEsT0FBQSxDQUFRLEdBQUEsQ0FBSSx3QkFBd0IsTUFBTSxDQUFBO0FBRTFDLEVBQUEsTUFBTSxFQUFFLFVBQVUsRUFBQSxFQUFHLEdBQUksTUFBTSxlQUFBLENBQWdCLFNBQUEsQ0FBVSxRQUFBLEVBQVUsc0JBQThCLENBQUE7QUFDakcsRUFBQSxTQUFBLENBQVUsQ0FBQSxxQ0FBQSxFQUF3QyxTQUFTLENBQUEsQ0FBRSxDQUFBO0FBQzdELEVBQUEsTUFBTUEsdUJBQUEsQ0FBYSxNQUFBLENBQU8sc0JBQUEsQ0FBdUIsQ0FBQSxHQUFBLEVBQU0sVUFBVSxDQUFBLDJDQUFBLENBQTZDLENBQUE7QUFFbEg7QUFHQSxlQUFlLGVBQUEsQ0FDWCxRQUFBLEVBQ0Esc0JBQUEsRUFDQSxNQUFBLEVBQ29DO0FBRXBDLEVBQUEsT0FBQSxDQUFRLElBQUksd0JBQXdCLENBQUE7QUFDcEMsRUFBQSxJQUFJO0FBQ0EsSUFBQSxNQUFNLE1BQUEsR0FBUyxNQUFNRiw0QkFBQSxDQUFnQixlQUFBLENBQWdCLFVBQVUsc0JBQXNCLENBQUE7QUFDckYsSUFBQSxPQUFBLENBQVEsSUFBSSxvQkFBb0IsQ0FBQTtBQUdoQyxJQUFBLE9BQU87QUFBQSxNQUNILElBQUksTUFBQSxDQUFPLEVBQUE7QUFBQSxNQUNYO0FBQUEsS0FDSjtBQUFBLEVBQ0osU0FBUyxHQUFBLEVBQWM7QUFDbkIsSUFBQSxNQUFNLEdBQUEsR0FBTSxDQUFBLDZCQUFBLEVBQWdDLE1BQUEsQ0FBTyxHQUFHLENBQUMsQ0FBQSxDQUFBO0FBQ3ZELElBQUEsT0FBQSxDQUFRLE1BQU0sR0FBRyxDQUFBO0FBQ2pCLElBQUEsU0FBQSxDQUFVLDhCQUE4QixDQUFBO0FBQ3hDLElBQUEsTUFBTUUsdUJBQUEsQ0FBYSxNQUFBLENBQU8sZ0JBQUEsQ0FBaUIsR0FBRyxDQUFBO0FBQzlDLElBQUEsTUFBTSxHQUFBO0FBQUEsRUFDVjtBQUNKO0FBRUEsU0FBUyxhQUFBLENBQWMsaUJBQWlCLEtBQUEsRUFBZ0Q7QUFDcEYsRUFBQSxNQUFNLFNBQUEsR0FBMkNFLHNCQUFTLHVCQUFBLEVBQXdCO0FBQ2xGLEVBQUEsTUFBTSxjQUFBLEdBQWlCLFNBQUEsQ0FBVSxJQUFBLENBQUssQ0FBQyxFQUFFLFVBQUEsRUFBQUMsV0FBQUEsRUFBVyxLQUFNQSxXQUFBQSxDQUFXLElBQUEsS0FBUyxRQUFBLElBQVlBLFdBQUFBLENBQVcsTUFBQSxPQUFhLFNBQVMsQ0FBQTtBQUMzSCxFQUFBLElBQUksQ0FBQyxjQUFBLEVBQWdCO0FBQ2pCLElBQUEsSUFBSSxjQUFBLEVBQWdCO0FBQ2hCLE1BQUEsT0FBTyxNQUFBO0FBQUEsSUFDWCxDQUFBLE1BQU87QUFDSCxNQUFBLE1BQU0sSUFBSSxNQUFNLDZCQUE2QixDQUFBO0FBQUEsSUFDakQ7QUFBQSxFQUNKO0FBQ0EsRUFBQSxJQUFJLGFBQTBDLGNBQUEsQ0FBZSxVQUFBO0FBRTdELEVBQUEsT0FBTyxVQUFBO0FBQ1g7QUFFQSxlQUFlLFNBQUEsQ0FDWCxPQUNBLE1BQUEsRUFDa0I7QUFFbEIsRUFBQSxPQUFBLENBQVEsR0FBQSxDQUFJLENBQUEsa0JBQUEsRUFBcUIsS0FBSyxDQUFBLElBQUEsQ0FBTSxDQUFBO0FBQzVDLEVBQUEsTUFBTSxhQUFhLGFBQUEsRUFBYztBQUdqQyxFQUFBLE9BQU8sWUFBQSxDQUFhLFVBQUEsRUFBWSxLQUFBLEVBQU8sQ0FBQyxNQUFBLEtBQXNCO0FBQUEsRUFBQyxDQUFDLENBQUEsQ0FDM0QsS0FBQSxDQUFNLENBQUMsR0FBQSxLQUFpQjtBQUNyQixJQUFBLE9BQUEsQ0FBUSxNQUFNLENBQUEsbUNBQUEsRUFBc0MsS0FBSyxLQUFLLE1BQUEsQ0FBTyxHQUFHLENBQUMsQ0FBQSxDQUFFLENBQUE7QUFDM0UsSUFBQSxNQUFNLEdBQUE7QUFBQSxFQUNWLENBQUMsQ0FBQSxDQUNBLElBQUEsQ0FBSyxDQUFBLFNBQUEsS0FBYTtBQUNmLElBQUEsT0FBQSxDQUFRLElBQUksMkJBQTJCLENBQUE7QUFDdkMsSUFBQSxPQUFPLFNBQUE7QUFBQSxFQUNYLENBQUMsQ0FBQTtBQUNUO0FBRUEsZUFBZSxZQUFBLENBQ1gsVUFBQSxFQUNBLEtBQUEsRUFDQSxRQUFBLEVBQ2tCO0FBQ2xCLEVBQUEsSUFBSSxTQUFBLEdBQVksTUFBQTtBQUVoQixFQUFBLElBQUk7QUFFQSxJQUFBLE1BQU1MLDRCQUFBLENBQWdCLFNBQUEsQ0FBVSxVQUFBLEVBQVksS0FBQSxFQUFPLFFBQVEsQ0FBQTtBQUczRCxJQUFBLFNBQUEsR0FBQSxDQUNJLE1BQU1BLDZCQUFnQixVQUFBLENBQVc7QUFBQSxNQUM3QixRQUFBLEVBQVU7QUFBQSxLQUNRLENBQUEsRUFDeEIsSUFBQSxDQUFLLENBQUFNLFVBQUFBLEtBQWFBLFVBQUFBLENBQVUsUUFBQSxFQUFVLElBQUEsQ0FBSyxDQUFBLEdBQUEsS0FBTyxHQUFBLEtBQVEsS0FBSyxDQUFDLENBQUE7QUFBQSxFQUV0RSxTQUFTLEdBQUEsRUFBYztBQUNuQixJQUFBLE9BQUEsQ0FBUSxJQUFBLENBQUssMERBQTBELEdBQUcsQ0FBQTtBQUMxRSxJQUFBLE1BQU1KLHVCQUFBLENBQWEsTUFBQSxDQUFPLGdCQUFBLENBQWlCLENBQUEsd0RBQUEsRUFBMkQsR0FBRyxDQUFBLENBQUUsQ0FBQTtBQUUzRyxJQUFBLE1BQU0sR0FBQTtBQUFBLEVBQ1Y7QUFFQSxFQUFBLElBQUksY0FBYyxNQUFBLEVBQVcsTUFBTSxJQUFJLEtBQUEsQ0FBTSxDQUFBLE1BQUEsRUFBUyxLQUFLLENBQUEsV0FBQSxDQUFhLENBQUE7QUFFeEUsRUFBQSxPQUFPLFNBQUE7QUFDWDtBQUVBLGVBQWUsbUJBQW1CLFNBQUEsRUFBVztBQUN6QyxFQUFBLE9BQUEsQ0FBUSxHQUFBLENBQUksQ0FBQSxzQ0FBQSxFQUF5QyxTQUFTLENBQUEsSUFBQSxDQUFNLENBQUE7QUFFcEUsRUFBQSxXQUFBLEdBQUEsQ0FBZSxNQUFNLFNBQVMsUUFBQSxDQUFTLFNBQUEsR0FBWSx5QkFBeUIsTUFBTSxDQUFBLEVBQUcsT0FBQSxDQUFRLEtBQUEsRUFBTyxFQUFFLENBQUE7QUFFdEcsRUFBQSxJQUFJLHFCQUFBLEtBQTBCLE1BQUE7QUFDMUIsSUFBQSxxQkFBQSxHQUFBLENBQXlCLE1BQU0sU0FBUyxRQUFBLENBQVMsU0FBQSxHQUFZLHFDQUFxQyxNQUFNLENBQUEsRUFBRyxPQUFBLENBQVEsS0FBQSxFQUFPLEVBQUUsQ0FBQTtBQUNwSTtBQUVBLGVBQWUsb0JBQUEsQ0FBcUIsYUFBYSxTQUFBLEVBQVc7QUFDeEQsRUFBQSxPQUFBLENBQVEsSUFBSSxDQUFBLHNDQUFBLENBQXdDLENBQUE7QUFFcEQsRUFBQSxJQUFJLENBQUMsRUFBQSxDQUFHLFVBQUEsQ0FBVyxXQUFXLENBQUEsRUFBRTtBQUM1QixJQUFBLEVBQUEsQ0FBRyxVQUFVLFdBQVcsQ0FBQTtBQUFBLEVBQzVCO0FBRUEsRUFBQSxJQUFJLFdBQUEsS0FBZ0IsTUFBQSxFQUFXLE1BQU0sSUFBSSxNQUFNLDhDQUE4QyxDQUFBO0FBRTdGLEVBQUEsYUFBQSxHQUFnQixDQUFBLEVBQUcsV0FBVyxDQUFBLENBQUEsRUFBSSxXQUFXLENBQUEsQ0FBQTtBQUM3QyxFQUFBLElBQUksQ0FBQyxFQUFBLENBQUcsVUFBQSxDQUFXLGFBQWEsQ0FBQSxFQUFFO0FBQzlCLElBQUEsTUFBTSxhQUFBLENBQWMsV0FBVyxhQUFhLENBQUE7QUFDNUMsSUFBQSxPQUFBLENBQVEsSUFBSSxlQUFlLENBQUE7QUFBQSxFQUMvQjtBQUNKO0FBRUEsZUFBc0IsU0FBUyxnQkFBQSxFQUFnRTtBQUUzRixFQUFBLG9CQUFBLEdBQXVCLGdCQUFBLENBQWlCLFdBQUE7QUFDeEMsRUFBQSxPQUFBLENBQVEsSUFBSSwyQ0FBMkMsQ0FBQTtBQUd2RCxFQUFBLE1BQU0sV0FBQSxHQUFjQSx1QkFBQSxDQUFhLFFBQUEsQ0FBUyxlQUFBLENBQWdCLHVCQUF1QixZQUFZO0FBQ3pGLElBQUEsSUFBdUIsQ0FBQ0EsdUJBQUEsQ0FBYSxHQUFBLENBQUksS0FBQSxFQUFPO0FBQzVDLE1BQUEsTUFBTUEsdUJBQUEsQ0FBYSxNQUFBLENBQU8sZ0JBQUEsQ0FBaUIsQ0FBQSwrQ0FBQSxDQUFpRCxDQUFBO0FBQzVGLE1BQUE7QUFBQSxJQUNKO0FBRUEsSUFBQSxJQUFJLE1BQUEsR0FBUyx1QkFBQTtBQUNiLElBQUEsSUFBSTtBQUNBLE1BQUEsTUFBQSxHQUFTLE1BQU0seUJBQXlCLEtBQUssQ0FBQTtBQUFBLElBQ2pELFNBQVMsR0FBQSxFQUFjO0FBQ25CLE1BQUEsTUFBTUEsdUJBQUEsQ0FBYSxNQUFBLENBQU8sZ0JBQUEsQ0FBaUIsR0FBRyxDQUFBO0FBQzlDLE1BQUE7QUFBQSxJQUNKO0FBRUEsSUFBQSxNQUFNLG9CQUFnRSxFQUFDO0FBWXZFLElBQUEsSUFBSSxVQUFBO0FBQ0osSUFBQSxJQUFJLFdBQVcsR0FBQSxFQUFLO0FBQ2hCLE1BQUEsVUFBQSxHQUFhLHlDQUFBO0FBQ2IsTUFBQSxpQkFBQSxDQUFrQixxQ0FBcUMsQ0FBQSxHQUFJLG1CQUFBO0FBQUEsSUFFL0QsQ0FBQSxNQUFBLElBQVcsTUFBQSxLQUFXLENBQUEsSUFBSyxNQUFBLEtBQVcsQ0FBQSxFQUFHO0FBQ3JDLE1BQUEsSUFBSSxXQUFXLENBQUEsRUFBRztBQUNkLFFBQUEsVUFBQSxHQUFhLG9DQUFBO0FBQ2IsUUFBQSxpQkFBQSxDQUFrQixxREFBcUQsQ0FBQSxHQUFJLHlCQUFBO0FBQzNFLFFBQUEsaUJBQUEsQ0FBa0Isb0NBQW9DLENBQUEsR0FBSSxlQUFBO0FBQzFELFFBQUEsaUJBQUEsQ0FBa0Isa0NBQWtDLENBQUEsR0FBSSxxQkFBQTtBQUFBLE1BQzVELENBQUEsTUFBTztBQUNILFFBQUEsVUFBQSxHQUFhLHFEQUFBO0FBQ2IsUUFBQSxpQkFBQSxDQUFrQiw0QkFBNEIsQ0FBQSxHQUFJLGdCQUFBO0FBQ2xELFFBQUEsaUJBQUEsQ0FBa0Isd0NBQXdDLENBQUEsR0FBSSx1QkFBQTtBQUFBLE1BQ2xFO0FBQ0EsTUFBQSxpQkFBQSxDQUFrQixLQUFLLElBQUksV0FBVztBQUFBLE1BQUMsQ0FBQTtBQUN2QyxNQUFBLGlCQUFBLENBQWtCLDZDQUE2QyxDQUFBLEdBQUksbUNBQUE7QUFBQSxJQUV2RSxXQUFXLE1BQUEsS0FBVyxFQUFBLElBQU0sTUFBQSxLQUFXLEVBQUEsSUFBTSxXQUFXLEVBQUEsRUFBSTtBQUN4RCxNQUFBLElBQUksV0FBVyxFQUFBLEVBQUk7QUFDZixRQUFBLFVBQUEsR0FBYSwwQkFBQTtBQUFBLE1BQ2pCLENBQUEsTUFBQSxJQUFXLFdBQVcsRUFBQSxFQUFJO0FBQ3RCLFFBQUEsVUFBQSxHQUFhLG1CQUFBO0FBQUEsTUFDakIsQ0FBQSxNQUFBLElBQVcsV0FBVyxFQUFBLEVBQUk7QUFDdEIsUUFBQSxVQUFBLEdBQWEsb0NBQUE7QUFBQSxNQUNqQjtBQUNBLE1BQUEsaUJBQUEsQ0FBa0Isa0RBQWtELENBQUEsR0FBSSxnQ0FBQTtBQUN4RSxNQUFBLGlCQUFBLENBQWtCLHFDQUFxQyxDQUFBLEdBQUkscUJBQUE7QUFBQSxJQUMvRDtBQUVBLElBQUEsaUJBQUEsQ0FBa0IsS0FBSyxJQUFJLFdBQVc7QUFBQSxJQUFDLENBQUE7QUFDdkMsSUFBQSxpQkFBQSxDQUFrQiwwQ0FBMEMsQ0FBQSxHQUFJLE1BQU0sd0JBQUEsQ0FBeUIsSUFBSSxDQUFBO0FBR25HLElBQUEsTUFBTSxNQUFBLEdBQVMsTUFBTUEsdUJBQUEsQ0FBYSxNQUFBLENBQU8sY0FBYyxNQUFBLENBQU8sSUFBQSxDQUFLLGlCQUFpQixDQUFBLEVBQUc7QUFBQSxNQUNuRixLQUFBLEVBQU8sQ0FBQTtBQUFBLGlCQUFBLEVBQ0EsVUFBVSxDQUFBLENBQUEsQ0FBQTtBQUFBLE1BQ2pCLFdBQUEsRUFBYTtBQUFBO0FBQUEsS0FDaEIsQ0FBQTtBQUVELElBQUEsSUFBSSxXQUFXLE1BQUEsRUFBVztBQUN0QixNQUFBLE9BQUEsQ0FBUSxJQUFJLDJCQUEyQixDQUFBO0FBQ3ZDLE1BQUE7QUFBQSxJQUNKO0FBRUEsSUFBQSxJQUFJO0FBQ0EsTUFBQSxNQUFNLGlCQUFBLENBQWtCLE1BQU0sQ0FBQSxFQUFFO0FBQUEsSUFDcEMsU0FBUyxHQUFBLEVBQWM7QUFDbkIsTUFBQSxNQUFNLEdBQUEsR0FBTSxDQUFBLGFBQUEsRUFBZ0IsTUFBQSxDQUFPLEdBQUcsQ0FBQyxDQUFBLENBQUE7QUFDdkMsTUFBQSxPQUFBLENBQVEsTUFBTSxHQUFHLENBQUE7QUFDakIsTUFBQSxNQUFNQSx1QkFBQSxDQUFhLE1BQUEsQ0FBTyxnQkFBQSxDQUFpQixHQUFHLENBQUE7QUFFOUMsTUFBQSxNQUFNLEdBQUE7QUFBQSxJQUNWO0FBQUEsRUFDSixDQUFDLENBQUE7QUFFRCxFQUFBLElBQUk7QUFHQSxJQUFBLFNBQUEsR0FBWUEsdUJBQUEsQ0FBYSxNQUFBLENBQU8sbUJBQUEsQ0FBb0JBLHVCQUFBLENBQWEsb0JBQW9CLEdBQUcsQ0FBQTtBQUV4RixJQUFBLFNBQUEsQ0FBVSxxQkFBcUIsQ0FBQTtBQUMvQixJQUFBLFNBQUEsQ0FBVSxPQUFBLEdBQVUscUJBQUE7QUFDcEIsSUFBQSxTQUFBLENBQVUsSUFBQSxFQUFLO0FBR2YsSUFBQSxnQkFBQSxDQUFpQixhQUFBLENBQWMsS0FBSyxXQUFXLENBQUE7QUFDL0MsSUFBQSxnQkFBQSxDQUFpQixhQUFBLENBQWMsS0FBSyxTQUFTLENBQUE7QUFBQSxFQUNqRCxTQUFTLEtBQUEsRUFBTztBQUNaLElBQUEsTUFBTSxHQUFBLEdBQU0sdURBQXVELEtBQUssQ0FBQSxDQUFBO0FBRXhFLElBQUEsTUFBTUEsdUJBQUEsQ0FBYSxNQUFBLENBQU8sZ0JBQUEsQ0FBaUIsR0FBRyxDQUFBO0FBQzlDLElBQUEsTUFBTSxJQUFJLE1BQU0sR0FBRyxDQUFBO0FBQUEsRUFDdkI7QUFFQSxFQUFBLElBQUk7QUFDQSxJQUFBLFNBQUEsQ0FBVSxnQkFBZ0IsQ0FBQTtBQUMxQixJQUFBLE1BQU0sbUJBQUEsRUFBb0I7QUFBQSxFQUM5QixTQUFTLEtBQUEsRUFBTztBQUNaLElBQUE7QUFBQSxFQUNKO0FBRUEsRUFBQSxTQUFBLENBQVUsQ0FBQSx5QkFBQSxDQUEyQixDQUFBO0FBQ3JDLEVBQUEsSUFBSTtBQUNBLElBQUEsc0JBQUEsRUFBdUI7QUFBQSxFQUMzQixTQUFTLEtBQUEsRUFBTztBQUNaLElBQUEsTUFBTSxHQUFBLEdBQU0sc0NBQXNDLEtBQUssQ0FBQSxDQUFBO0FBRXZELElBQUEsTUFBTUEsdUJBQUEsQ0FBYSxNQUFBLENBQU8sZ0JBQUEsQ0FBaUIsR0FBRyxDQUFBO0FBQzlDLElBQUEsU0FBQSxDQUFVLENBQUEsR0FBQSxFQUFNLEdBQUcsQ0FBQSxDQUFFLENBQUE7QUFDckIsSUFBQTtBQUFBLEVBQ0o7QUFFQSxFQUFBLFNBQUEsRUFBVTtBQUNkO0FBRUEsZUFBc0IsVUFBQSxHQUE0QjtBQUVsRDtBQUVBLGVBQWUsbUJBQUEsR0FBc0I7QUFDakMsRUFBQSxJQUFJO0FBQ0EsSUFBQSxNQUFNLG1CQUFtQixvQkFBb0IsQ0FBQTtBQUM3QyxJQUFBLE9BQUEsQ0FBUSxHQUFBLENBQUksQ0FBQSx3QkFBQSxFQUEyQixXQUFXLENBQUEsSUFBQSxDQUFNLENBQUE7QUFDeEQsSUFBQSxTQUFBLENBQVUsT0FBQSxHQUFVLFdBQVcsV0FBVyxDQUFBLENBQUE7QUFDMUMsSUFBQSxPQUFBLENBQVEsR0FBQSxDQUFJLENBQUEsWUFBQSxFQUFlLHFCQUFxQixDQUFBLENBQUUsQ0FBQTtBQUVsRCxJQUFBLFNBQUEsQ0FBVSxDQUFBLDhCQUFBLENBQWdDLENBQUE7QUFDMUMsSUFBQSxNQUFNLG9CQUFBLENBQXFCLHNCQUFzQixvQkFBb0IsQ0FBQTtBQUVyRSxJQUFBLFNBQUEsQ0FBVSxDQUFBLHdCQUFBLENBQTBCLENBQUE7QUFDcEMsSUFBQSxNQUFNLGVBQUEsRUFBZ0I7QUFDdEIsSUFBQSxTQUFBLENBQVUsQ0FBQSxvQkFBQSxDQUFzQixDQUFBO0FBQUEsRUFDcEMsU0FBUyxLQUFBLEVBQU87QUFDWixJQUFBLE1BQU0sR0FBQSxHQUFNLHNDQUFzQyxLQUFLLENBQUEsQ0FBQTtBQUN2RCxJQUFBLFNBQUEsQ0FBVSxDQUFBLEdBQUEsRUFBTSxHQUFHLENBQUEsQ0FBRSxDQUFBO0FBQ3JCLElBQUEsTUFBTUEsdUJBQUEsQ0FBYSxNQUFBLENBQU8sZ0JBQUEsQ0FBaUIsR0FBRyxDQUFBO0FBQzlDLElBQUEsTUFBTSxLQUFBO0FBQUEsRUFDVjtBQUNKO0FBRUEsZUFBZSxxQkFBQSxHQUF3QjtBQUNuQyxFQUFBLElBQUksb0JBQUEsS0FBeUIsTUFBQSxFQUFXLE1BQU0sSUFBSSxNQUFNLHFDQUFxQyxDQUFBO0FBQzdGLEVBQUEsU0FBQSxDQUFVLENBQUEsZ0NBQUEsQ0FBa0MsQ0FBQTtBQUM1QyxFQUFBLE1BQU0sV0FBVyxFQUFDO0FBRWxCLEVBQUEsZUFBQSxDQUFnQixvQkFBQSxFQUFzQixnQ0FBQSxFQUFrQyxTQUFTLFFBQUEsRUFBVTtBQUFDLElBQUEsUUFBQSxDQUFTLElBQUEsQ0FBSyxJQUFBLENBQUssT0FBQSxDQUFRLFFBQVEsQ0FBQyxDQUFBO0FBQUEsRUFBQyxDQUFDLENBQUE7QUFFbEksRUFBQSxLQUFBLE1BQVcsV0FBVyxRQUFBLEVBQVU7QUFDNUIsSUFBQSxPQUFBLENBQVEsSUFBQSxDQUFLLGdDQUFnQyxPQUFPLENBQUE7QUFFcEQsSUFBQSxFQUFBLENBQUcsT0FBTyxPQUFBLEVBQVMsRUFBRSxXQUFXLElBQUEsRUFBTSxLQUFBLEVBQU8sTUFBTSxDQUFBO0FBQUEsRUFDdkQ7QUFDQSxFQUFBLE9BQUEsQ0FBUSxLQUFLLGtCQUFrQixDQUFBO0FBRS9CLEVBQUEsU0FBQSxDQUFVLENBQUEseUJBQUEsQ0FBMkIsQ0FBQTtBQUN6QztBQUVBLGVBQWUsaUJBQUEsQ0FBa0IsaUJBQWlCLEtBQUEsRUFBb0M7QUFDbEYsRUFBQSxJQUFJO0FBQ0EsSUFBQSxNQUFNLFVBQUEsR0FBYSxjQUFjLGNBQWMsQ0FBQTtBQUMvQyxJQUFBLE1BQU0sY0FBQSxHQUFpQixhQUFhLE1BQU0sQ0FBQTtBQUUxQyxJQUFBLElBQUksQ0FBQyxjQUFBLElBQWtCLGNBQUEsS0FBbUIsS0FBQSxDQUFBLEVBQVc7QUFDakQsTUFBQSxNQUFNLElBQUksTUFBTSxvQ0FBb0MsQ0FBQTtBQUFBLElBQ3hEO0FBQ0EsSUFBQSxJQUFJLGNBQUEsRUFBZ0I7QUFDaEIsTUFBQSxPQUFBLENBQVEsR0FBQSxDQUFJLGlCQUFpQixjQUFjLENBQUE7QUFBQSxJQUMvQztBQUNBLElBQUEsT0FBTyxjQUFBO0FBQUEsRUFDWCxTQUFTLEtBQUEsRUFBTztBQUNaLElBQUEsTUFBTSxHQUFBLEdBQU0sbURBQW1ELEtBQUssQ0FBQSxDQUFBO0FBQ3BFLElBQUEsTUFBTUEsdUJBQUEsQ0FBYSxNQUFBLENBQU8sZ0JBQUEsQ0FBaUIsR0FBRyxDQUFBO0FBQzlDLElBQUEsT0FBQSxDQUFRLE1BQU0sR0FBRyxDQUFBO0FBQ2pCLElBQUEsU0FBQSxDQUFVLENBQUEsR0FBQSxFQUFNLEdBQUcsQ0FBQSxDQUFFLENBQUE7QUFDckIsSUFBQSxNQUFNLElBQUksTUFBTSxHQUFHLENBQUE7QUFBQSxFQUN2QjtBQUNKO0FBRUEsZUFBZSxnQ0FBQSxHQUFrRDtBQUM3RCxFQUFBLElBQUksYUFBQSxLQUFrQixNQUFBLEVBQVcsTUFBTSxJQUFJLE1BQU0sK0NBQStDLENBQUE7QUFFaEcsRUFBQSxNQUFNLGNBQUEsR0FBaUIsTUFBTSxpQkFBQSxDQUFrQixJQUFJLENBQUE7QUFFbkQsRUFBQSxJQUFJO0FBQ0EsSUFBQSxTQUFBLENBQVUsNERBQTRELENBQUE7QUFDdEUsSUFBQSxNQUFNLElBQUEsR0FBTyxDQUFDLE1BQUEsRUFBUSxDQUFBLEVBQUcsYUFBYSxDQUFBLHFDQUFBLENBQXVDLENBQUE7QUFDN0UsSUFBQSxJQUFJLG1CQUFtQixLQUFBLENBQUEsRUFBVztBQUM5QixNQUFBLElBQUEsQ0FBSyxLQUFLLGNBQWMsQ0FBQTtBQUN4QixNQUFBLE9BQUEsQ0FBUSxHQUFBLENBQUksQ0FBQSxpQkFBQSxFQUFvQixjQUFjLENBQUEsQ0FBRSxDQUFBO0FBQUEsSUFDcEQsQ0FBQSxNQUFPO0FBQ0gsTUFBQSxPQUFBLENBQVEsSUFBSSxDQUFBLDRCQUFBLENBQThCLENBQUE7QUFBQSxJQUM5QztBQUVBLElBQUEsTUFBTSxFQUFFLE1BQUEsRUFBTyxHQUFJLE1BQU1BLHVCQUFBLENBQWEsT0FBQSxDQUFRLElBQUEsQ0FBSyxjQUFBLEVBQWdCLElBQUEsRUFBTSxFQUFDLEdBQUEsRUFBSyxhQUFBLEVBQWMsQ0FBQTtBQUU3RixJQUFBLE1BQU0sR0FBQSxHQUFNLG9FQUFBO0FBQ1osSUFBQSxNQUFNQSx1QkFBQSxDQUFhLE1BQUEsQ0FBTyxzQkFBQSxDQUF1QixHQUFHLENBQUE7QUFDcEQsSUFBQSxPQUFBLENBQVEsSUFBSSxHQUFHLENBQUE7QUFDZixJQUFBLFNBQUEsQ0FBVSxpQ0FBaUMsQ0FBQTtBQUFBLEVBQy9DLFNBQVMsS0FBQSxFQUFPO0FBQ1osSUFBQSxNQUFNLEdBQUEsR0FBTSxtRUFBbUUsS0FBSyxDQUFBLENBQUE7QUFDcEYsSUFBQSxNQUFNQSx1QkFBQSxDQUFhLE1BQUEsQ0FBTyxnQkFBQSxDQUFpQixHQUFHLENBQUE7QUFDOUMsSUFBQSxPQUFBLENBQVEsTUFBTSxHQUFHLENBQUE7QUFDakIsSUFBQSxTQUFBLENBQVUsQ0FBQSxHQUFBLEVBQU0sR0FBRyxDQUFBLENBQUUsQ0FBQTtBQUNyQixJQUFBLE1BQU0sSUFBSSxNQUFNLEdBQUcsQ0FBQTtBQUFBLEVBQ3ZCO0FBQ0o7QUFFQSxlQUFlLG1DQUFBLEdBQXFEO0FBQ2hFLEVBQUEsTUFBTSxjQUFBLEdBQWlCLE1BQU0saUJBQUEsRUFBa0I7QUFFL0MsRUFBQSxJQUFJO0FBQ0EsSUFBQSxTQUFBLENBQVUsb0NBQW9DLENBQUE7QUFDOUMsSUFBQSxNQUFNLEVBQUUsTUFBQSxFQUFPLEdBQUksTUFBTUEsdUJBQUEsQ0FBYSxPQUFBLENBQVEsSUFBQSxDQUFLLFFBQUEsRUFBVSxDQUFDLFNBQUEsRUFBVyxNQUFBLEVBQVEsY0FBYyxDQUFDLENBQUE7QUFBQSxFQUNwRyxTQUFTLEtBQUEsRUFBTztBQUNaLElBQUEsTUFBTUssSUFBQUEsR0FBTSxzQ0FBc0MsS0FBSyxDQUFBLENBQUE7QUFDdkQsSUFBQSxTQUFBLENBQVUsQ0FBQSxHQUFBLEVBQU1BLElBQUcsQ0FBQSxDQUFFLENBQUE7QUFDckIsSUFBQSxNQUFNTCx1QkFBQSxDQUFhLE1BQUEsQ0FBTyxnQkFBQSxDQUFpQkssSUFBRyxDQUFBO0FBQzlDLElBQUEsT0FBQSxDQUFRLE1BQU1BLElBQUcsQ0FBQTtBQUNqQixJQUFBLE1BQU0sSUFBSSxNQUFNQSxJQUFHLENBQUE7QUFBQSxFQUN2QjtBQUVBLEVBQUEsSUFBSTtBQUNBLElBQUEsU0FBQSxDQUFVLDhDQUE4QyxDQUFBO0FBQ3hELElBQUEsTUFBTSxFQUFFLE1BQUEsRUFBTyxHQUFJLE1BQU1MLHVCQUFBLENBQWEsT0FBQSxDQUFRLElBQUEsQ0FBSyxRQUFBLEVBQVUsQ0FBQyxTQUFBLEVBQVcsT0FBQSxFQUFTLGNBQWMsQ0FBQyxDQUFBO0FBQUEsRUFDckcsU0FBUyxLQUFBLEVBQU87QUFDWixJQUFBLE1BQU1LLElBQUFBLEdBQU0seUNBQXlDLEtBQUssQ0FBQSxDQUFBO0FBQzFELElBQUEsU0FBQSxDQUFVLENBQUEsR0FBQSxFQUFNQSxJQUFHLENBQUEsQ0FBRSxDQUFBO0FBQ3JCLElBQUEsTUFBTUwsdUJBQUEsQ0FBYSxNQUFBLENBQU8sZ0JBQUEsQ0FBaUJLLElBQUcsQ0FBQTtBQUM5QyxJQUFBLE9BQUEsQ0FBUSxNQUFNQSxJQUFHLENBQUE7QUFDakIsSUFBQSxNQUFNLElBQUksTUFBTUEsSUFBRyxDQUFBO0FBQUEsRUFDdkI7QUFFQSxFQUFBLE1BQU0sR0FBQSxHQUFNLG9FQUFBO0FBQ1osRUFBQSxNQUFNTCx1QkFBQSxDQUFhLE1BQUEsQ0FBTyxzQkFBQSxDQUF1QixHQUFHLENBQUE7QUFDcEQsRUFBQSxPQUFBLENBQVEsSUFBSSxHQUFHLENBQUE7QUFDZixFQUFBLFNBQUEsQ0FBVSx5Q0FBeUMsQ0FBQTtBQUN2RDtBQUVBLGVBQWUsZUFBQSxHQUFpQztBQUM1QyxFQUFBLElBQUksYUFBQSxLQUFrQixNQUFBLEVBQVcsTUFBTSxJQUFJLE1BQU0sK0NBQStDLENBQUE7QUFFaEcsRUFBQSxJQUFJLEVBQUEsQ0FBRyxVQUFBLENBQVcsQ0FBQSxFQUFHLGFBQWEsY0FBYyxDQUFBLEVBQUc7QUFDL0MsSUFBQSxPQUFBLENBQVEsSUFBSSw0QkFBNEIsQ0FBQTtBQUN4QyxJQUFBO0FBQUEsRUFDSjtBQUVBLEVBQUEsU0FBQSxDQUFVLENBQUEsc0RBQUEsQ0FBd0QsQ0FBQTtBQUNsRSxFQUFBLElBQUksQ0FBQyxFQUFBLENBQUcsVUFBQSxDQUFXLENBQUEsRUFBRyxhQUFhLG9CQUFvQixDQUFBLEVBQUc7QUFDdEQsSUFBQSxNQUFNLEdBQUEsR0FBTSx3Q0FBd0MsYUFBYSxDQUFBLGlDQUFBLENBQUE7QUFDakUsSUFBQSxPQUFBLENBQVEsTUFBTSxHQUFHLENBQUE7QUFDakIsSUFBQSxNQUFNLElBQUksTUFBTSxHQUFHLENBQUE7QUFBQSxFQUN2QjtBQUVBLEVBQUEsSUFBSTtBQUNBLElBQUEsTUFBTSxFQUFFLE1BQUEsRUFBTyxHQUFJLE1BQU1BLHVCQUFBLENBQWEsUUFBUSxJQUFBLENBQUssY0FBQSxFQUFnQixDQUFDLE1BQUEsRUFBUSxHQUFHLGFBQWEsQ0FBQSxrQkFBQSxDQUFvQixHQUFHLEVBQUMsR0FBQSxFQUFLLGVBQWMsQ0FBQTtBQUFBLEVBQzNJLFNBQVMsS0FBQSxFQUFPO0FBQ1osSUFBQSxPQUFBLENBQVEsTUFBTSxLQUFLLENBQUE7QUFDbkIsSUFBQSxNQUFNLElBQUksS0FBQSxDQUFNLENBQUEsc0NBQUEsRUFBeUMsS0FBSyxDQUFBLEVBQUEsRUFBSyxLQUFBLENBQU0sTUFBTSxDQUFBLENBQUUsQ0FBQTtBQUFBLEVBQ3JGO0FBQ0EsRUFBQSxTQUFBLENBQVUsQ0FBQSxvQkFBQSxDQUFzQixDQUFBO0FBQ3BDO0FBRUEsZUFBZSx5QkFBeUIsUUFBQSxFQUFvQztBQUN4RSxFQUFBLElBQUksQ0FBQyxFQUFBLENBQUcsVUFBQSxDQUFXLENBQUEsRUFBRyxhQUFhLGlDQUFpQyxDQUFBLEVBQUc7QUFDbkUsSUFBQSxPQUFBLENBQVEsR0FBQSxDQUFJLENBQUEsOENBQUEsRUFBaUQsYUFBYSxDQUFBLENBQUUsQ0FBQTtBQUM1RSxJQUFBLFNBQUEsQ0FBVSxpQkFBaUIsQ0FBQTtBQUMzQixJQUFBLElBQUksUUFBQSxFQUFVO0FBQ1YsTUFBQSxNQUFNQSx1QkFBQSxDQUFhLE1BQUEsQ0FBTyxzQkFBQSxDQUF1QiwyQ0FBMkMsQ0FBQTtBQUFBLElBQ2hHO0FBQ0EsSUFBQSxPQUFPLEdBQUE7QUFBQSxFQUNYO0FBRUEsRUFBQSxJQUFJO0FBQ0EsSUFBQSxNQUFNLEVBQUUsTUFBQSxFQUFPLEdBQUksTUFBTUEsdUJBQUEsQ0FBYSxRQUFRLElBQUEsQ0FBSyxjQUFBLEVBQWdCLENBQUMsTUFBQSxFQUFRLEdBQUcsYUFBYSxDQUFBLCtCQUFBLENBQWlDLEdBQUcsRUFBQyxHQUFBLEVBQUssZUFBYyxDQUFBO0FBRXBKLElBQUEsTUFBTSxNQUFBLEdBQVMsTUFBQSxDQUFPLE9BQUEsQ0FBUSxLQUFBLEVBQU8sRUFBRSxDQUFBO0FBQ3ZDLElBQUEsTUFBTSxHQUFBLEdBQU0sQ0FBQTtBQUFBLEVBQXdDLE1BQU0sQ0FBQSxDQUFBO0FBQzFELElBQUEsSUFBSSxRQUFBLEVBQVU7QUFDVixNQUFBLE1BQU1BLHVCQUFBLENBQWEsTUFBQSxDQUFPLHNCQUFBLENBQXVCLEdBQUcsQ0FBQTtBQUFBLElBQ3hEO0FBQ0EsSUFBQSxPQUFBLENBQVEsSUFBSSxHQUFHLENBQUE7QUFDZixJQUFBLE1BQU0sYUFBQSxHQUFnQixNQUFNLHVCQUFBLEVBQXdCO0FBQ3BELElBQUEsSUFBSSxrQkFBa0IsS0FBQSxDQUFBLEVBQVc7QUFDN0IsTUFBQSxTQUFBLENBQVUsQ0FBQSwyQkFBQSxDQUE2QixDQUFBO0FBQ3ZDLE1BQUEsT0FBTyxDQUFBO0FBQUEsSUFDWCxDQUFBLE1BQU87QUFDSCxNQUFBLFNBQUEsQ0FBVSxJQUFJLENBQUE7QUFDZCxNQUFBLE9BQU8sQ0FBQTtBQUFBLElBQ1g7QUFBQSxFQUVKLFNBQVMsS0FBQSxFQUFPO0FBQ1osSUFBQSxJQUFJLEdBQUE7QUFDSixJQUFBLE1BQU0sTUFBQSxHQUFTLEtBQUEsQ0FBTSxNQUFBLENBQU8sT0FBQSxDQUFRLE9BQU8sRUFBRSxDQUFBO0FBQzdDLElBQUEsTUFBTSxXQUFXLEtBQUEsQ0FBTSxRQUFBO0FBRXZCLElBQUEsSUFBSSxRQUFBLEdBQVcsRUFBQSxJQUFNLFFBQUEsR0FBVyxFQUFBLEVBQUk7QUFFaEMsTUFBQSxHQUFBLEdBQUssNkJBQTZCLE1BQU0sQ0FBQSxDQUFBO0FBQ3hDLE1BQUEsSUFBSSxRQUFBLEVBQVU7QUFDVixRQUFBLE1BQU1BLHVCQUFBLENBQWEsTUFBQSxDQUFPLHNCQUFBLENBQXVCLEdBQUcsQ0FBQTtBQUFBLE1BQ3hEO0FBQ0EsTUFBQSxPQUFBLENBQVEsS0FBSyxHQUFHLENBQUE7QUFDaEIsTUFBQSxJQUFJLFFBQUEsS0FBYSxFQUFBLElBQU0sUUFBQSxLQUFhLEVBQUEsRUFBSTtBQUNwQyxRQUFBLFNBQUEsQ0FBVSx3REFBd0QsQ0FBQTtBQUFBLE1BQ3RFLENBQUEsTUFBQSxJQUFXLGFBQWEsRUFBQSxFQUFJO0FBQ3hCLFFBQUEsU0FBQSxDQUFVLCtCQUErQixDQUFBO0FBQUEsTUFDN0MsQ0FBQSxNQUFPO0FBQ0gsUUFBQSxTQUFBLENBQVUsQ0FBQSx3QkFBQSxFQUEyQixRQUFRLENBQUEsQ0FBRSxDQUFBO0FBQy9DLFFBQUEsT0FBQSxDQUFRLEtBQUssQ0FBQSxxQkFBQSxFQUF3QixRQUFRLENBQUEsRUFBQSxFQUFLLEtBQUEsQ0FBTSxNQUFNLENBQUEsQ0FBRSxDQUFBO0FBQUEsTUFDcEU7QUFFQSxNQUFBLE9BQU8sUUFBQTtBQUFBLElBQ1g7QUFHQSxJQUFBLEdBQUEsR0FBSyxDQUFBLHVDQUFBLEVBQTBDLE1BQU0sQ0FBQSxRQUFBLEVBQVcsUUFBUSxDQUFBLENBQUEsQ0FBQTtBQUN4RSxJQUFBLE1BQU1BLHVCQUFBLENBQWEsTUFBQSxDQUFPLGdCQUFBLENBQWlCLEdBQUcsQ0FBQTtBQUM5QyxJQUFBLE9BQUEsQ0FBUSxNQUFNLEdBQUcsQ0FBQTtBQUNqQixJQUFBLFNBQUEsQ0FBVSxDQUFBLEdBQUEsRUFBTSxHQUFHLENBQUEsQ0FBRSxDQUFBO0FBQ3JCLElBQUEsTUFBTSxJQUFJLE1BQU0sR0FBRyxDQUFBO0FBQUEsRUFDdkI7QUFDSjs7Ozs7OyJ9
