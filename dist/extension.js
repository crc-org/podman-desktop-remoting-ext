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
    value: `ramalama --image "${RamalamaRemotingImage}" run llama3.2`
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
`
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
async function pullImage(image, labels) {
  console.log(`Pulling the image ${image} ...`);
  const providers = extensionApi.provider.getContainerConnections();
  const podmanProvider = providers.find(({ connection: connection2 }) => connection2.type === "podman");
  if (!podmanProvider) throw new Error("cannot find podman provider");
  let connection = podmanProvider.connection;
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
async function restart_podman_machine_with_apir() {
  if (LocalBuildDir === void 0) throw new Error("LocalBuildDir not loaded. This is unexpected.");
  try {
    setStatus("⚙️ Restarting PodMan Machine with API Remoting support ...");
    const { stdout } = await extensionApi__namespace.process.exec("/usr/bin/env", ["bash", `${LocalBuildDir}/podman_start_machine.api_remoting.sh`], { cwd: LocalBuildDir });
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
  try {
    setStatus("⚙️ Stopping the PodMan Machine ...");
    const { stdout } = await extensionApi__namespace.process.exec("podman", ["machine", "stop"]);
  } catch (error) {
    const msg2 = `Failed to stop the PodMan Machine: ${error}`;
    setStatus(`🔴 ${msg2}`);
    await extensionApi__namespace.window.showErrorMessage(msg2);
    console.error(msg2);
    throw new Error(msg2);
  }
  try {
    setStatus("⚙️ Restarting the default PodMan Machine ...");
    const { stdout } = await extensionApi__namespace.process.exec("podman", ["machine", "start"]);
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZXh0ZW5zaW9uLmpzIiwic291cmNlcyI6WyIuLi9zcmMvZXh0ZW5zaW9uLnRzIl0sInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB0eXBlIHtcbiAgICBDb250YWluZXJDcmVhdGVPcHRpb25zLFxuICAgIENvbnRhaW5lckNyZWF0ZVJlc3VsdCxcbiAgICBDb250YWluZXJQcm92aWRlckNvbm5lY3Rpb24sXG4gICAgRGV2aWNlLFxuICAgIExpc3RJbWFnZXNPcHRpb25zLFxuICAgIFB1bGxFdmVudCxcbiAgICBEZXZpY2VSZXF1ZXN0LFxuICAgIEltYWdlSW5mbyxcbiAgICBNb3VudENvbmZpZyxcbiAgICBQcm92aWRlckNvbnRhaW5lckNvbm5lY3Rpb24sXG59IGZyb20gJ0Bwb2RtYW4tZGVza3RvcC9hcGknO1xuXG5pbXBvcnQgKiBhcyBleHRlbnNpb25BcGkgZnJvbSAnQHBvZG1hbi1kZXNrdG9wL2FwaSc7XG5pbXBvcnQgdHlwZSB7IFBvZG1hbkNvbm5lY3Rpb24gfSBmcm9tICcuLi8uLi9tYW5hZ2Vycy9wb2RtYW5Db25uZWN0aW9uJztcbmltcG9ydCAqIGFzIFBvZG1hbkNvbm5lY3Rpb25BUEkgZnJvbSAnLi4vLi4vbWFuYWdlcnMvcG9kbWFuQ29ubmVjdGlvbic7XG5pbXBvcnQgeyBjb250YWluZXJFbmdpbmUsIHByb3ZpZGVyLCBQcm9ncmVzc0xvY2F0aW9uIH0gZnJvbSAnQHBvZG1hbi1kZXNrdG9wL2FwaSc7XG5cbmV4cG9ydCBjb25zdCBTRUNPTkQ6IG51bWJlciA9IDFfMDAwXzAwMF8wMDA7XG5cbmNvbnN0IHBhdGggPSByZXF1aXJlKCdwYXRoJyk7XG5jb25zdCBmcyA9IHJlcXVpcmUoJ2ZzJyk7XG5jb25zdCBhc3luY19mcyA9IHJlcXVpcmUoJ2ZzL3Byb21pc2VzJyk7XG5cbmNvbnN0IEF2YWlsYWJsZU1vZGVscyA9IHt9O1xubGV0IEV4dGVuc2lvblN0b3JhZ2VQYXRoID0gdW5kZWZpbmVkO1xuXG5jb25zdCBGQUlMX0lGX05PVF9NQUMgPSB0cnVlO1xuY29uc3QgRVhURU5TSU9OX0JVSUxEX1BBVEggPSBwYXRoLnBhcnNlKF9fZmlsZW5hbWUpLmRpciArIFwiLy4uL2J1aWxkXCI7XG5jb25zdCBSRVNUUklDVF9PUEVOX1RPX0dHVUZfRklMRVMgPSBmYWxzZTtcbmNvbnN0IFNFQVJDSF9BSV9MQUJfTU9ERUxTID0gdHJ1ZTtcblxubGV0IFJhbWFsYW1hUmVtb3RpbmdJbWFnZSA9IHVuZGVmaW5lZDtcbmxldCBBcGlyVmVyc2lvbiA9IHVuZGVmaW5lZDtcbmxldCBMb2NhbEJ1aWxkRGlyID0gdW5kZWZpbmVkO1xubGV0IFN0YXR1c0JhciA9IHVuZGVmaW5lZDtcbmxldCBOb0FpTGFiTW9kZWxXYXJuaW5nU2hvd24gPSBmYWxzZTtcblxuZnVuY3Rpb24gc2V0U3RhdHVzKHN0YXR1cykge1xuICAgIGNvbnNvbGUubG9nKGBBUEkgUmVtb3Rpbmcgc3RhdHVzOiAke3N0YXR1c31gKVxuICAgIGlmIChTdGF0dXNCYXIgPT09IHVuZGVmaW5lZCkge1xuXHRjb25zb2xlLndhcm4oXCJTdGF0dXMgYmFyIG5vdCBhdmFpbGFibGUgLi4uXCIpO1xuXHRyZXR1cm47XG4gICAgfVxuICAgIGlmIChzdGF0dXMgPT09IHVuZGVmaW5lZCkge1xuXHRTdGF0dXNCYXIudGV4dCA9IGBMbGFtYS5jcHAgQVBJIFJlbW90aW5nYFxuICAgIH0gZWxzZSB7XG5cdFN0YXR1c0Jhci50ZXh0ID0gYExsYW1hLmNwcCBBUEkgUmVtb3Rpbmc6ICR7c3RhdHVzfWBcbiAgICB9XG59XG5cbmZ1bmN0aW9uIHJlZ2lzdGVyRnJvbURpcihzdGFydFBhdGgsIGZpbHRlciwgcmVnaXN0ZXIpIHtcbiAgICBpZiAoIWZzLmV4aXN0c1N5bmMoc3RhcnRQYXRoKSkge1xuICAgICAgICBjb25zb2xlLmxvZyhcIm5vIGRpciBcIiwgc3RhcnRQYXRoKTtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHZhciBmaWxlcyA9IGZzLnJlYWRkaXJTeW5jKHN0YXJ0UGF0aCk7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBmaWxlcy5sZW5ndGg7IGkrKykge1xuICAgICAgICB2YXIgZmlsZW5hbWUgPSBwYXRoLmpvaW4oc3RhcnRQYXRoLCBmaWxlc1tpXSk7XG4gICAgICAgIHZhciBzdGF0ID0gZnMubHN0YXRTeW5jKGZpbGVuYW1lKTtcbiAgICAgICAgaWYgKHN0YXQuaXNEaXJlY3RvcnkoKSkge1xuICAgICAgICAgICAgcmVnaXN0ZXJGcm9tRGlyKGZpbGVuYW1lLCBmaWx0ZXIsIHJlZ2lzdGVyKTsgLy9yZWN1cnNlXG4gICAgICAgIH0gZWxzZSBpZiAoZmlsZW5hbWUuZW5kc1dpdGgoZmlsdGVyKSkge1xuICAgICAgICAgICAgcmVnaXN0ZXIoZmlsZW5hbWUpO1xuICAgICAgICB9O1xuICAgIH07XG59O1xuXG4vLyBnZW5lcmF0ZWQgYnkgY2hhdGdwdFxuYXN5bmMgZnVuY3Rpb24gY29weVJlY3Vyc2l2ZShzcmMsIGRlc3QpIHtcbiAgY29uc3QgZW50cmllcyA9IGF3YWl0IGFzeW5jX2ZzLnJlYWRkaXIoc3JjLCB7IHdpdGhGaWxlVHlwZXM6IHRydWUgfSk7XG5cbiAgYXdhaXQgYXN5bmNfZnMubWtkaXIoZGVzdCwgeyByZWN1cnNpdmU6IHRydWUgfSk7XG5cbiAgZm9yIChsZXQgZW50cnkgb2YgZW50cmllcykge1xuICAgIGNvbnN0IHNyY1BhdGggPSBwYXRoLmpvaW4oc3JjLCBlbnRyeS5uYW1lKTtcbiAgICBjb25zdCBkZXN0UGF0aCA9IHBhdGguam9pbihkZXN0LCBlbnRyeS5uYW1lKTtcblxuICAgIGlmIChlbnRyeS5pc0RpcmVjdG9yeSgpKSB7XG4gICAgICBhd2FpdCBjb3B5UmVjdXJzaXZlKHNyY1BhdGgsIGRlc3RQYXRoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgYXdhaXQgYXN5bmNfZnMuY29weUZpbGUoc3JjUGF0aCwgZGVzdFBhdGgpO1xuICAgIH1cbiAgfVxufVxuXG5jb25zdCBnZXRSYW5kb21TdHJpbmcgPSAoKTogc3RyaW5nID0+IHtcbiAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIHNvbmFyanMvcHNldWRvLXJhbmRvbVxuICByZXR1cm4gKE1hdGgucmFuZG9tKCkgKyAxKS50b1N0cmluZygzNikuc3Vic3RyaW5nKDcpO1xufTtcblxuZnVuY3Rpb24gcmVmcmVzaEF2YWlsYWJsZU1vZGVscygpIHtcbiAgICBpZiAoIVNFQVJDSF9BSV9MQUJfTU9ERUxTKSB7XG5cdGNvbnNvbGUubG9nKFwiU2VhcmNoaW5nIEFJIGxhYiBtb2RlbHMgaXMgZGlzYWJsZWQuIFNraXBwaW5nIHJlZnJlc2hBdmFpbGFibGVNb2RlbHMuXCIpXG5cdHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAoRXh0ZW5zaW9uU3RvcmFnZVBhdGggPT09IHVuZGVmaW5lZCkgdGhyb3cgbmV3IEVycm9yKCdFeHRlbnNpb25TdG9yYWdlUGF0aCBub3QgZGVmaW5lZCA6LycpO1xuXG4gICAgLy8gZGVsZXRlIHRoZSBleGlzdGluZyBtb2RlbHNcbiAgICBPYmplY3Qua2V5cyhBdmFpbGFibGVNb2RlbHMpLmZvckVhY2goa2V5ID0+IGRlbGV0ZSBBdmFpbGFibGVNb2RlbHNba2V5XSk7XG5cbiAgICBjb25zdCByZWdpc3Rlck1vZGVsID0gZnVuY3Rpb24oZmlsZW5hbWUpIHtcbiAgICAgICAgY29uc3QgZGlyX25hbWUgPSBmaWxlbmFtZS5zcGxpdChcIi9cIikuYXQoLTIpXG4gICAgICAgIGNvbnN0IG5hbWVfcGFydHMgPSBkaXJfbmFtZS5zcGxpdChcIi5cIilcbiAgICAgICAgLy8gMCBpcyB0aGUgc291cmNlIChlZywgaGYpXG4gICAgICAgIGNvbnN0IG1vZGVsX2RpciA9IG5hbWVfcGFydHMuYXQoMSlcbiAgICAgICAgY29uc3QgbW9kZWxfbmFtZSA9IG5hbWVfcGFydHMuc2xpY2UoMikuam9pbignLicpXG4gICAgICAgIGNvbnN0IG1vZGVsX3VzZXJfbmFtZSA9IGAke21vZGVsX2Rpcn0vJHttb2RlbF9uYW1lfWBcbiAgICAgICAgQXZhaWxhYmxlTW9kZWxzW21vZGVsX3VzZXJfbmFtZV0gPSBmaWxlbmFtZTtcbiAgICAgICAgY29uc29sZS5sb2coYGZvdW5kICR7bW9kZWxfdXNlcl9uYW1lfWApXG4gICAgfVxuXG4gICAgcmVnaXN0ZXJGcm9tRGlyKEV4dGVuc2lvblN0b3JhZ2VQYXRoICsgJy8uLi9yZWRoYXQuYWktbGFiL21vZGVscycsICcuZ2d1ZicsIHJlZ2lzdGVyTW9kZWwpO1xufVxuXG5mdW5jdGlvbiBzbGVlcChtcykge1xuICByZXR1cm4gbmV3IFByb21pc2UocmVzb2x2ZSA9PiBzZXRUaW1lb3V0KHJlc29sdmUsIG1zKSk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGhhc0FwaXJDb250YWluZXJSdW5uaW5nKCkge1xuICAgIGNvbnN0IGNvbnRhaW5lckluZm8gPSAoYXdhaXQgY29udGFpbmVyRW5naW5lLmxpc3RDb250YWluZXJzKCkpLmZpbmQoXG5cdGNvbnRhaW5lckluZm8gPT5cblx0Y29udGFpbmVySW5mby5MYWJlbHM/LlsnbGxhbWEtY3BwLmFwaXInXSA9PT0gJ3RydWUnICYmXG5cdCAgICBjb250YWluZXJJbmZvLlN0YXRlID09PSAncnVubmluZycsXG4gICAgKTtcblxuICAgIHJldHVybiBjb250YWluZXJJbmZvO1xufVxuXG5hc3luYyBmdW5jdGlvbiBzdG9wQXBpckluZmVyZW5jZVNlcnZlcigpIHtcbiAgICBjb25zdCBjb250YWluZXJJbmZvID0gYXdhaXQgaGFzQXBpckNvbnRhaW5lclJ1bm5pbmcoKTtcbiAgICBpZiAoY29udGFpbmVySW5mbyA9PT0gdW5kZWZpbmVkKSB7XG5cdGNvbnN0IG1zZyA9IGDwn5S0IENvdWxkIG5vdCBmaW5kIGFuIEFQSSBSZW1vdGluZyBjb250YWluZXIgcnVubmluZyAuLi5gXG5cdHNldFN0YXR1cyhtc2cpO1xuICAgICAgICBhd2FpdCBleHRlbnNpb25BcGkud2luZG93LnNob3dFcnJvck1lc3NhZ2UobXNnKTtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBzZXRTdGF0dXMoXCLimpnvuI8gU3RvcHBpbmcgdGhlIGluZmVyZW5jZSBzZXJ2ZXIgLi4uXCIpXG4gICAgYXdhaXQgY29udGFpbmVyRW5naW5lLnN0b3BDb250YWluZXIoY29udGFpbmVySW5mby5lbmdpbmVJZCwgY29udGFpbmVySW5mby5JZCk7XG4gICAgYXdhaXQgY2hlY2tQb2RtYW5NYWNoaW5lU3RhdHVzKGZhbHNlKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gc2hvd1JhbWFsYW1hQ2hhdCgpIHtcbiAgICBjb25zdCBjb250YWluZXJJbmZvID0gYXdhaXQgaGFzQXBpckNvbnRhaW5lclJ1bm5pbmcoKTtcbiAgICBpZiAoY29udGFpbmVySW5mbyA9PT0gdW5kZWZpbmVkKSB7XG5cdGNvbnN0IG1zZyA9IGDwn5S0IENvdWxkIG5vdCBmaW5kIGFuIEFQSSBSZW1vdGluZyBjb250YWluZXIgcnVubmluZyAuLi5gXG5cdHNldFN0YXR1cyhtc2cpO1xuICAgICAgICBhd2FpdCBleHRlbnNpb25BcGkud2luZG93LnNob3dFcnJvck1lc3NhZ2UobXNnKTtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCBhcGlfdXJsID0gY29udGFpbmVySW5mbz8uTGFiZWxzPy5hcGk7XG5cbiAgICBpZiAoIWFwaV91cmwpIHtcblx0Y29uc3QgbXNnID0gJ/CflLQgTWlzc2luZyBBUEkgVVJMIGxhYmVsIG9uIHRoZSBydW5uaW5nIEFQSVIgY29udGFpbmVyLic7XG5cdHNldFN0YXR1cyhtc2cpO1xuXHRhd2FpdCBleHRlbnNpb25BcGkud2luZG93LnNob3dFcnJvck1lc3NhZ2UobXNnKTtcblx0cmV0dXJuO1xuICAgIH1cblxuICAgIGF3YWl0IGV4dGVuc2lvbkFwaS53aW5kb3cuc2hvd0lucHV0Qm94KHtcblx0dGl0bGU6IFwicmFtYWxhbWEgY2hhdFwiLFxuXHRwcm9tcHQ6IFwiUmFtYUxhbWEgY29tbWFuZCB0byBjaGF0IHdpdGggdGhlIEFQSSBSZW1vdGluZyBtb2RlbFwiLFxuXHRtdWx0aWxpbmU6IHRydWUsXG5cdHZhbHVlOiBgcmFtYWxhbWEgY2hhdCAtLXVybCBcIiR7YXBpX3VybH1cImAsXG4gICAgfSk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHNob3dSYW1hbGFtYVJ1bigpIHtcbiAgICBpZiAoIVJhbWFsYW1hUmVtb3RpbmdJbWFnZSkge1xuXHRhd2FpdCBleHRlbnNpb25BcGkud2luZG93LnNob3dFcnJvck1lc3NhZ2UoJ0FQSVIgaW1hZ2UgaXMgbm90IGxvYWRlZCB5ZXQuJyk7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG4gICAgYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93SW5wdXRCb3goe1xuXHR0aXRsZTogXCJyYW1hbGFtYSBydW5cIixcblx0cHJvbXB0OiBcIlJhbWFMYW1hIGNvbW1hbmQgdG8gbGF1bmNoIGEgbW9kZWxcIixcblx0bXVsdGlsaW5lOiB0cnVlLFxuXHR2YWx1ZTogYHJhbWFsYW1hIC0taW1hZ2UgXCIke1JhbWFsYW1hUmVtb3RpbmdJbWFnZX1cIiBydW4gbGxhbWEzLjJgLFxuICAgIH0pO1xufVxuXG5hc3luYyBmdW5jdGlvbiBzaG93UmFtYWxhbWFCZW5jaG1hcmsoKSB7XG4gICAgaWYgKCFSYW1hbGFtYVJlbW90aW5nSW1hZ2UpIHtcblx0YXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93RXJyb3JNZXNzYWdlKCdBUElSIGltYWdlIGlzIG5vdCBsb2FkZWQgeWV0LicpO1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93SW5wdXRCb3goe1xuXHR0aXRsZTogXCJyYW1hbGFtYSBiZW5jaFwiLFxuXHRwcm9tcHQ6IFwiUmFtYUxhbWEgY29tbWFuZHMgdG8gcnVuIGJlbmNobWFya3NcIixcblx0bXVsdGlsaW5lOiB0cnVlLFxuXHR2YWx1ZTogYFxuIyBWZW51cy1WdWxrYW4gYmVuY2htYXJraW5nXG5yYW1hbGFtYSBiZW5jaCBsbGFtYTMuMlxuXG4jIE5hdGl2ZSBNZXRhbCBiZW5jaG1hcmtpbmcgKG5lZWRzIFxcYGxsYW1hLWJlbmNoXFxgIGluc3RhbGxlZClcbnJhbWFsYW1hIC0tbm9jb250YWluZXIgYmVuY2ggbGxhbWEzLjJcblxuIyBBUEkgUmVtb3RpbmcgYmVuY2htYXJrXG5yYW1hbGFtYSBiZW5jaCAgLS1pbWFnZSBcIiR7UmFtYWxhbWFSZW1vdGluZ0ltYWdlfVwiIGxsYW1hMy4yXG5gXG5cbiAgICB9KTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gbGF1bmNoQXBpckluZmVyZW5jZVNlcnZlcigpIHtcbiAgICBjb25zdCBjb250YWluZXJJbmZvID0gYXdhaXQgaGFzQXBpckNvbnRhaW5lclJ1bm5pbmcoKTtcbiAgICBpZiAoY29udGFpbmVySW5mbyAhPT0gdW5kZWZpbmVkKSB7XG5cdGNvbnN0IGlkID0gY29udGFpbmVySW5mby5JZDtcbiAgICAgICAgY29uc29sZS5lcnJvcihgQVBJIFJlbW90aW5nIGNvbnRhaW5lciAke2lkfSBhbHJlYWR5IHJ1bm5pbmcgLi4uYCk7XG4gICAgICAgIGF3YWl0IGV4dGVuc2lvbkFwaS53aW5kb3cuc2hvd0Vycm9yTWVzc2FnZShg8J+foCBBUEkgUmVtb3RpbmcgY29udGFpbmVyICR7aWR9IGlzIGFscmVhZHkgcnVubmluZy4gVGhpcyB2ZXJzaW9uIGNhbm5vdCBoYXZlIHR3byBBUEkgUmVtb3RpbmcgY29udGFpbmVycyBydW5uaW5nIHNpbXVsdGFuZW91c2x5LmApO1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKFJhbWFsYW1hUmVtb3RpbmdJbWFnZSA9PT0gdW5kZWZpbmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJSYW1hbGFtYSBSZW1vdGluZyBpbWFnZSBuYW1lIG5vdCBsb2FkZWQuIFRoaXMgaXMgdW5leHBlY3RlZC5cIik7XG5cbiAgICBzZXRTdGF0dXMoXCLimpnvuI8gQ29uZmlndXJpbmcgdGhlIGluZmVyZW5jZSBzZXJ2ZXIgLi4uXCIpXG4gICAgbGV0IG1vZGVsX25hbWU7XG4gICAgaWYgKE9iamVjdC5rZXlzKEF2YWlsYWJsZU1vZGVscykubGVuZ3RoID09PSAwKSB7XG5cdGlmICghTm9BaUxhYk1vZGVsV2FybmluZ1Nob3duKSB7XG5cdCAgICBhd2FpdCBleHRlbnNpb25BcGkud2luZG93LnNob3dJbmZvcm1hdGlvbk1lc3NhZ2UoYPCfn6AgQ291bGQgbm90IGZpbmQgYW55IG1vZGVsIGRvd25sb2FkZWQgZnJvbSBBSSBMYWIuIFBsZWFzZSBzZWxlY3QgYSBHR1VGIGZpbGUgdG8gbG9hZC5gKTtcblx0ICAgIE5vQWlMYWJNb2RlbFdhcm5pbmdTaG93biA9IHRydWU7XG5cdH1cblx0bGV0IHVyaXMgPSBhd2FpdCBleHRlbnNpb25BcGkud2luZG93LnNob3dPcGVuRGlhbG9nKHtcblx0ICAgIHRpdGxlOiBcIlNlbGVjdCBhIEdHVUYgbW9kZWwgZmlsZVwiLFxuXHQgICAgb3BlbkxhYmVsOiBcIlNlbGVjdFwiLFxuXHQgICAgY2FuU2VsZWN0RmlsZXM6IHRydWUsXG5cdCAgICBjYW5TZWxlY3RGb2xkZXJzOiBmYWxzZSxcblx0ICAgIGNhblNlbGVjdE1hbnk6IGZhbHNlLFxuXHQgICAgZmlsdGVyczogeyAnR0dVRiBNb2RlbHMnOiBbJ2dndWYnXSB9LFxuXHR9KVxuXG5cdGlmICghdXJpcyB8fCB1cmlzLmxlbmd0aCA9PT0gMCkge1xuXHQgICAgY29uc29sZS5sb2coXCJObyBtb2RlbCBzZWxlY3RlZCwgYWJvcnRpbmcgdGhlIEFQSVIgY29udGFpbmVyIGxhdW5jaCBzaWxlbnRseS5cIilcblx0ICAgIHJldHVybjtcblx0fVxuXHRtb2RlbF9uYW1lID0gdXJpc1swXS5mc1BhdGg7XG5cblx0aWYgKFJFU1RSSUNUX09QRU5fVE9fR0dVRl9GSUxFUykge1xuXHQgICAgaWYgKHBhdGguZXh0bmFtZShtb2RlbF9uYW1lKS50b0xvd2VyQ2FzZSgpICE9PSAnLmdndWYnKSB7XG5cdFx0Y29uc3QgbXNnID0gYFNlbGVjdGVkIGZpbGUgaXNuJ3QgYSAuZ2d1ZjogJHttb2RlbF9uYW1lfWBcblx0XHRjb25zb2xlLndhcm4obXNnKTtcblx0XHRhd2FpdCBleHRlbnNpb25BcGkud2luZG93LnNob3dFcnJvck1lc3NhZ2UobXNnKTtcblx0XHRyZXR1cm47XG5cdCAgICB9XG5cdH1cblxuXHRpZiAoIWZzLmV4aXN0c1N5bmMobW9kZWxfbmFtZSkpe1xuICAgICAgICAgICAgY29uc3QgbXNnID0gYFNlbGVjdGVkIEdHVUYgbW9kZWwgZmlsZSBkb2VzIG5vdCBleGlzdDogJHttb2RlbF9uYW1lfWBcbiAgICAgICAgICAgIGNvbnNvbGUud2Fybihtc2cpO1xuICAgICAgICAgICAgYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93RXJyb3JNZXNzYWdlKG1zZyk7XG5cdCAgICByZXR1cm47XG5cdH1cblxuXG4gICAgfSBlbHNlIHtcbiAgICAgICAgcmVmcmVzaEF2YWlsYWJsZU1vZGVscygpO1xuXG4gICAgICAgIC8vIGRpc3BsYXkgYSBjaG9pY2UgdG8gdGhlIHVzZXIgZm9yIHNlbGVjdGluZyBzb21lIHZhbHVlc1xuICAgICAgICBtb2RlbF9uYW1lID0gYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93UXVpY2tQaWNrKE9iamVjdC5rZXlzKEF2YWlsYWJsZU1vZGVscyksIHtcbiAgICAgICAgICAgIGNhblBpY2tNYW55OiBmYWxzZSwgLy8gdXNlciBjYW4gc2VsZWN0IG1vcmUgdGhhbiBvbmUgY2hvaWNlXG4gICAgICAgICAgICB0aXRsZTogXCJDaG9vc2UgdGhlIG1vZGVsIHRvIGRlcGxveVwiLFxuICAgICAgICB9KTtcbiAgICAgICAgaWYgKG1vZGVsX25hbWUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgY29uc29sZS53YXJuKCdObyBtb2RlbCBjaG9zZW4sIG5vdGhpbmcgdG8gbGF1bmNoLicpXG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBwcmVwYXJlIHRoZSBwb3J0XG5cbiAgICBjb25zdCBob3N0X3BvcnRfc3RyID0gYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93SW5wdXRCb3goe1xuXHR0aXRsZTogXCJTZXJ2aWNlIHBvcnRcIixcblx0cHJvbXB0OiBcIkluZmVyZW5jZSBzZXJ2aWNlIHBvcnQgb24gdGhlIGhvc3RcIixcblx0dmFsdWU6IFwiMTIzNFwiLFxuXHR2YWxpZGF0ZUlucHV0OiAodmFsdWUpID0+IChwYXJzZUludCh2YWx1ZSwgMTApID4gMTAyNCA/IFwiXCIgOiBcIkVudGVyIGEgdmFsaWQgcG9ydCA+IDEwMjRcIiksXG4gICAgfSk7XG4gICAgY29uc3QgaG9zdF9wb3J0ID0gaG9zdF9wb3J0X3N0ciA/IHBhcnNlSW50KGhvc3RfcG9ydF9zdHIsIDEwKSA6IE51bWJlci5OYU47XG5cbiAgICBpZiAoTnVtYmVyLmlzTmFOKGhvc3RfcG9ydCkpIHtcbiAgICAgICAgY29uc29sZS53YXJuKCdObyBob3N0IHBvcnQgY2hvc2VuLCBub3RoaW5nIHRvIGxhdW5jaC4nKVxuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgc2V0U3RhdHVzKFwi4pqZ77iPIFB1bGxpbmcgdGhlIGltYWdlIC4uLlwiKVxuICAgIC8vIHB1bGwgdGhlIGltYWdlXG4gICAgY29uc3QgaW1hZ2VJbmZvOiBJbWFnZUluZm8gPSBhd2FpdCBwdWxsSW1hZ2UoXG4gICAgICAgIFJhbWFsYW1hUmVtb3RpbmdJbWFnZSxcbiAgICAgICAge30sXG4gICAgKTtcblxuICAgIHNldFN0YXR1cyhcIuKame+4jyBDcmVhdGluZyB0aGUgY29udGFpbmVyIC4uLlwiKVxuICAgIC8vIGdldCBtb2RlbCBtb3VudCBzZXR0aW5nc1xuICAgIGNvbnN0IG1vZGVsX3NyYzogc3RyaW5nID0gQXZhaWxhYmxlTW9kZWxzW21vZGVsX25hbWVdID8/IG1vZGVsX25hbWU7XG5cbiAgICBpZiAobW9kZWxfc3JjID09PSB1bmRlZmluZWQpXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgQ291bGRuJ3QgZ2V0IHRoZSBmaWxlIGFzc29jaWF0ZWQgd2l0aCBtb2RlbCAke21vZGVsX3NyY30uIFRoaXMgaXMgdW5leHBlY3RlZC5gKTtcblxuICAgIGNvbnN0IG1vZGVsX2ZpbGVuYW1lID0gcGF0aC5iYXNlbmFtZShtb2RlbF9zcmMpO1xuICAgIGNvbnN0IG1vZGVsX2Rpcm5hbWUgPSBwYXRoLmJhc2VuYW1lKHBhdGguZGlybmFtZShtb2RlbF9zcmMpKTtcbiAgICBjb25zdCBtb2RlbF9kZXN0ID0gYC9tb2RlbHMvJHttb2RlbF9maWxlbmFtZX1gO1xuICAgIGNvbnN0IGFpX2xhYl9wb3J0ID0gMTA0MzQ7XG5cbiAgICAvLyBwcmVwYXJlIHRoZSBsYWJlbHNcbiAgICBjb25zdCBsYWJlbHM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7XG4gICAgICAgIFsnYWktbGFiLWluZmVyZW5jZS1zZXJ2ZXInXTogSlNPTi5zdHJpbmdpZnkoW21vZGVsX2Rpcm5hbWVdKSxcbiAgICAgICAgWydhcGknXTogYGh0dHA6Ly8xMjcuMC4wLjE6JHtob3N0X3BvcnR9L3YxYCxcbiAgICAgICAgWydkb2NzJ106IGBodHRwOi8vMTI3LjAuMC4xOiR7YWlfbGFiX3BvcnR9L2FwaS1kb2NzLyR7aG9zdF9wb3J0fWAsXG4gICAgICAgIFsnZ3B1J106IGBsbGFtYS5jcHAgQVBJIFJlbW90aW5nYCxcbiAgICAgICAgW1widHJhY2tpbmdJZFwiXTogZ2V0UmFuZG9tU3RyaW5nKCksXG4gICAgICAgIFtcImxsYW1hLWNwcC5hcGlyXCJdOiBcInRydWVcIixcbiAgICB9O1xuXG4gICAgLy8gcHJlcGFyZSB0aGUgbW91bnRzXG4gICAgLy8gbW91bnQgdGhlIGZpbGUgZGlyZWN0b3J5IHRvIGF2b2lkIGFkZGluZyBvdGhlciBmaWxlcyB0byB0aGUgY29udGFpbmVyc1xuICAgIGNvbnN0IG1vdW50czogTW91bnRDb25maWcgPSBbXG4gICAgICB7XG4gICAgICAgICAgVGFyZ2V0OiBtb2RlbF9kZXN0LFxuICAgICAgICAgIFNvdXJjZTogbW9kZWxfc3JjLFxuICAgICAgICAgIFR5cGU6ICdiaW5kJyxcblx0ICBSZWFkT25seTogdHJ1ZSxcbiAgICAgIH0sXG4gICAgXTtcblxuICAgIC8vIHByZXBhcmUgdGhlIGVudHJ5cG9pbnRcbiAgICBsZXQgZW50cnlwb2ludDogc3RyaW5nIHwgdW5kZWZpbmVkID0gdW5kZWZpbmVkO1xuICAgIGxldCBjbWQ6IHN0cmluZ1tdID0gW107XG5cbiAgICBlbnRyeXBvaW50ID0gXCIvdXNyL2Jpbi9sbGFtYS1zZXJ2ZXIuc2hcIjtcblxuICAgIC8vIHByZXBhcmUgdGhlIGVudlxuICAgIGNvbnN0IGVudnM6IHN0cmluZ1tdID0gW2BNT0RFTF9QQVRIPSR7bW9kZWxfZGVzdH1gLCAnSE9TVD0wLjAuMC4wJywgJ1BPUlQ9ODAwMCcsICdHUFVfTEFZRVJTPTk5OSddO1xuXG4gICAgLy8gcHJlcGFyZSB0aGUgZGV2aWNlc1xuICAgIGNvbnN0IGRldmljZXM6IERldmljZVtdID0gW107XG4gICAgZGV2aWNlcy5wdXNoKHtcbiAgICAgICAgUGF0aE9uSG9zdDogJy9kZXYvZHJpJyxcbiAgICAgICAgUGF0aEluQ29udGFpbmVyOiAnL2Rldi9kcmknLFxuICAgICAgICBDZ3JvdXBQZXJtaXNzaW9uczogJycsXG4gICAgfSk7XG5cbiAgICBjb25zdCBkZXZpY2VSZXF1ZXN0czogRGV2aWNlUmVxdWVzdFtdID0gW107XG4gICAgZGV2aWNlUmVxdWVzdHMucHVzaCh7XG4gICAgICAgIENhcGFiaWxpdGllczogW1snZ3B1J11dLFxuICAgICAgICBDb3VudDogLTEsIC8vIC0xOiBhbGxcbiAgICB9KTtcblxuICAgIC8vIEdldCB0aGUgY29udGFpbmVyIGNyZWF0aW9uIG9wdGlvbnNcbiAgICBjb25zdCBjb250YWluZXJDcmVhdGVPcHRpb25zOiBDb250YWluZXJDcmVhdGVPcHRpb25zID0ge1xuICAgICAgICBJbWFnZTogaW1hZ2VJbmZvLklkLFxuICAgICAgICBEZXRhY2g6IHRydWUsXG4gICAgICAgIEVudHJ5cG9pbnQ6IGVudHJ5cG9pbnQsXG4gICAgICAgIENtZDogY21kLFxuICAgICAgICBFeHBvc2VkUG9ydHM6IHsgW2Ake2hvc3RfcG9ydH0vdGNwYF06IHt9IH0sXG4gICAgICAgIEhvc3RDb25maWc6IHtcbiAgICAgICAgICAgIEF1dG9SZW1vdmU6IGZhbHNlLFxuICAgICAgICAgICAgRGV2aWNlczogZGV2aWNlcyxcbiAgICAgICAgICAgIE1vdW50czogbW91bnRzLFxuICAgICAgICAgICAgRGV2aWNlUmVxdWVzdHM6IGRldmljZVJlcXVlc3RzLFxuICAgICAgICAgICAgU2VjdXJpdHlPcHQ6IFtcImxhYmVsPWRpc2FibGVcIl0sXG4gICAgICAgICAgICBQb3J0QmluZGluZ3M6IHtcbiAgICAgICAgICAgICAgICAnODAwMC90Y3AnOiBbXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIEhvc3RQb3J0OiBgJHtob3N0X3BvcnR9YCxcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgfSxcblxuICAgICAgICBIZWFsdGhDaGVjazoge1xuICAgICAgICAgIC8vIG11c3QgYmUgdGhlIHBvcnQgSU5TSURFIHRoZSBjb250YWluZXIgbm90IHRoZSBleHBvc2VkIG9uZVxuICAgICAgICAgIFRlc3Q6IFsnQ01ELVNIRUxMJywgYGN1cmwgLXNTZiBsb2NhbGhvc3Q6ODAwMCA+IC9kZXYvbnVsbGBdLFxuICAgICAgICAgIEludGVydmFsOiBTRUNPTkQgKiA1LFxuICAgICAgICAgIFJldHJpZXM6IDQgKiA1LFxuICAgICAgICAgIH0sXG4gICAgICAgIExhYmVsczogbGFiZWxzLFxuICAgICAgICBFbnY6IGVudnMsXG4gICAgfTtcbiAgICBjb25zb2xlLmxvZyhjb250YWluZXJDcmVhdGVPcHRpb25zLCBtb3VudHMpXG4gICAgLy8gQ3JlYXRlIHRoZSBjb250YWluZXJcbiAgICBjb25zdCB7IGVuZ2luZUlkLCBpZCB9ID0gYXdhaXQgY3JlYXRlQ29udGFpbmVyKGltYWdlSW5mby5lbmdpbmVJZCwgY29udGFpbmVyQ3JlYXRlT3B0aW9ucywgbGFiZWxzKTtcbiAgICBzZXRTdGF0dXMoYPCfjokgSW5mZXJlbmNlIHNlcnZlciBpcyByZWFkeSBvbiBwb3J0ICR7aG9zdF9wb3J0fWApXG4gICAgYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93SW5mb3JtYXRpb25NZXNzYWdlKGDwn46JICR7bW9kZWxfbmFtZX0gaXMgcnVubmluZyB3aXRoIEFQSSBSZW1vdGluZyBhY2NlbGVyYXRpb24hYCk7XG5cbn1cbmV4cG9ydCB0eXBlIEJldHRlckNvbnRhaW5lckNyZWF0ZVJlc3VsdCA9IENvbnRhaW5lckNyZWF0ZVJlc3VsdCAmIHsgZW5naW5lSWQ6IHN0cmluZyB9O1xuXG5hc3luYyBmdW5jdGlvbiBjcmVhdGVDb250YWluZXIoXG4gICAgZW5naW5lSWQ6IHN0cmluZyxcbiAgICBjb250YWluZXJDcmVhdGVPcHRpb25zOiBDb250YWluZXJDcmVhdGVPcHRpb25zLFxuICAgIGxhYmVsczogeyBbaWQ6IHN0cmluZ106IHN0cmluZyB9LFxuKTogUHJvbWlzZTxCZXR0ZXJDb250YWluZXJDcmVhdGVSZXN1bHQ+IHtcblxuICAgIGNvbnNvbGUubG9nKFwiQ3JlYXRpbmcgY29udGFpbmVyIC4uLlwiKTtcbiAgICB0cnkge1xuICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBjb250YWluZXJFbmdpbmUuY3JlYXRlQ29udGFpbmVyKGVuZ2luZUlkLCBjb250YWluZXJDcmVhdGVPcHRpb25zKTtcbiAgICAgICAgY29uc29sZS5sb2coXCJDb250YWluZXIgY3JlYXRlZCFcIik7XG5cbiAgICAgICAgLy8gcmV0dXJuIHRoZSBDb250YWluZXJDcmVhdGVSZXN1bHRcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGlkOiByZXN1bHQuaWQsXG4gICAgICAgICAgICBlbmdpbmVJZDogZW5naW5lSWQsXG4gICAgICAgIH07XG4gICAgfSBjYXRjaCAoZXJyOiB1bmtub3duKSB7XG4gICAgICAgIGNvbnN0IG1zZyA9IGBDb250YWluZXIgY3JlYXRpb24gZmFpbGVkIDovICR7U3RyaW5nKGVycil9YFxuICAgICAgICBjb25zb2xlLmVycm9yKG1zZyk7XG5cdHNldFN0YXR1cyhcIvCflLQgQ29udGFpbmVyIGNyZWF0aW9uIGZhaWxlZFwiKVxuICAgICAgICBhd2FpdCBleHRlbnNpb25BcGkud2luZG93LnNob3dFcnJvck1lc3NhZ2UobXNnKTtcbiAgICAgICAgdGhyb3cgZXJyO1xuICAgIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gcHVsbEltYWdlKFxuICAgIGltYWdlOiBzdHJpbmcsXG4gICAgbGFiZWxzOiB7IFtpZDogc3RyaW5nXTogc3RyaW5nIH0sXG4pOiBQcm9taXNlPEltYWdlSW5mbz4ge1xuICAgIC8vIENyZWF0aW5nIGEgdGFzayB0byBmb2xsb3cgcHVsbGluZyBwcm9ncmVzc1xuICAgIGNvbnNvbGUubG9nKGBQdWxsaW5nIHRoZSBpbWFnZSAke2ltYWdlfSAuLi5gKVxuXG4gICAgY29uc3QgcHJvdmlkZXJzOiBQcm92aWRlckNvbnRhaW5lckNvbm5lY3Rpb25bXSA9IHByb3ZpZGVyLmdldENvbnRhaW5lckNvbm5lY3Rpb25zKCk7XG4gICAgY29uc3QgcG9kbWFuUHJvdmlkZXIgPSBwcm92aWRlcnMuZmluZCgoeyBjb25uZWN0aW9uIH0pID0+IGNvbm5lY3Rpb24udHlwZSA9PT0gJ3BvZG1hbicpO1xuICAgIGlmICghcG9kbWFuUHJvdmlkZXIpIHRocm93IG5ldyBFcnJvcignY2Fubm90IGZpbmQgcG9kbWFuIHByb3ZpZGVyJyk7XG4gICAgbGV0IGNvbm5lY3Rpb246IENvbnRhaW5lclByb3ZpZGVyQ29ubmVjdGlvbiA9IHBvZG1hblByb3ZpZGVyLmNvbm5lY3Rpb247XG5cbiAgICAvLyBnZXQgdGhlIGRlZmF1bHQgaW1hZ2UgaW5mbyBmb3IgdGhpcyBwcm92aWRlclxuICAgIHJldHVybiBnZXRJbWFnZUluZm8oY29ubmVjdGlvbiwgaW1hZ2UsIChfZXZlbnQ6IFB1bGxFdmVudCkgPT4ge30pXG4gICAgICAgIC5jYXRjaCgoZXJyOiB1bmtub3duKSA9PiB7XG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKGBTb21ldGhpbmcgd2VudCB3cm9uZyB3aGlsZSBwdWxsaW5nICR7aW1hZ2V9OiAke1N0cmluZyhlcnIpfWApO1xuICAgICAgICAgICAgdGhyb3cgZXJyO1xuICAgICAgICB9KVxuICAgICAgICAudGhlbihpbWFnZUluZm8gPT4ge1xuICAgICAgICAgICAgY29uc29sZS5sb2coXCJJbWFnZSBwdWxsZWQgc3VjY2Vzc2Z1bGx5XCIpO1xuICAgICAgICAgICAgcmV0dXJuIGltYWdlSW5mbztcbiAgICAgICAgfSk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGdldEltYWdlSW5mbyhcbiAgY29ubmVjdGlvbjogQ29udGFpbmVyUHJvdmlkZXJDb25uZWN0aW9uLFxuICBpbWFnZTogc3RyaW5nLFxuICBjYWxsYmFjazogKGV2ZW50OiBQdWxsRXZlbnQpID0+IHZvaWQsXG4pOiBQcm9taXNlPEltYWdlSW5mbz4ge1xuICAgIGxldCBpbWFnZUluZm8gPSB1bmRlZmluZWQ7XG5cbiAgICB0cnkge1xuICAgICAgICAvLyBQdWxsIGltYWdlXG4gICAgICAgIGF3YWl0IGNvbnRhaW5lckVuZ2luZS5wdWxsSW1hZ2UoY29ubmVjdGlvbiwgaW1hZ2UsIGNhbGxiYWNrKTtcblxuICAgICAgICAvLyBHZXQgaW1hZ2UgaW5zcGVjdFxuICAgICAgICBpbWFnZUluZm8gPSAoXG4gICAgICAgICAgICBhd2FpdCBjb250YWluZXJFbmdpbmUubGlzdEltYWdlcyh7XG4gICAgICAgICAgICAgICAgcHJvdmlkZXI6IGNvbm5lY3Rpb24sXG4gICAgICAgICAgICB9IGFzIExpc3RJbWFnZXNPcHRpb25zKVxuICAgICAgICApLmZpbmQoaW1hZ2VJbmZvID0+IGltYWdlSW5mby5SZXBvVGFncz8uc29tZSh0YWcgPT4gdGFnID09PSBpbWFnZSkpO1xuXG4gICAgfSBjYXRjaCAoZXJyOiB1bmtub3duKSB7XG4gICAgICAgIGNvbnNvbGUud2FybignU29tZXRoaW5nIHdlbnQgd3Jvbmcgd2hpbGUgdHJ5aW5nIHRvIGdldCBpbWFnZSBpbnNwZWN0JywgZXJyKTtcbiAgICAgICAgYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93RXJyb3JNZXNzYWdlKGBTb21ldGhpbmcgd2VudCB3cm9uZyB3aGlsZSB0cnlpbmcgdG8gZ2V0IGltYWdlIGluc3BlY3Q6ICR7ZXJyfWApO1xuXG4gICAgICAgIHRocm93IGVycjtcbiAgICB9XG5cbiAgICBpZiAoaW1hZ2VJbmZvID09PSB1bmRlZmluZWQpIHRocm93IG5ldyBFcnJvcihgaW1hZ2UgJHtpbWFnZX0gbm90IGZvdW5kLmApO1xuXG4gICAgcmV0dXJuIGltYWdlSW5mbztcbn1cblxuYXN5bmMgZnVuY3Rpb24gaW5pdGlhbGl6ZUJ1aWxkRGlyKGJ1aWxkUGF0aCkge1xuICAgIGNvbnNvbGUubG9nKGBJbml0aWFsaXppbmcgdGhlIGJ1aWxkIGRpcmVjdG9yeSBmcm9tICR7YnVpbGRQYXRofSAuLi5gKVxuXG4gICAgQXBpclZlcnNpb24gPSAoYXdhaXQgYXN5bmNfZnMucmVhZEZpbGUoYnVpbGRQYXRoICsgJy9zcmNfaW5mby92ZXJzaW9uLnR4dCcsICd1dGY4JykpLnJlcGxhY2UoL1xcbiQvLCBcIlwiKTtcblxuICAgIGlmIChSYW1hbGFtYVJlbW90aW5nSW1hZ2UgPT09IHVuZGVmaW5lZClcbiAgICAgICAgUmFtYWxhbWFSZW1vdGluZ0ltYWdlID0gKGF3YWl0IGFzeW5jX2ZzLnJlYWRGaWxlKGJ1aWxkUGF0aCArICcvc3JjX2luZm8vcmFtYWxhbWEuaW1hZ2UtaW5mby50eHQnLCAndXRmOCcpKS5yZXBsYWNlKC9cXG4kLywgXCJcIik7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGluaXRpYWxpemVTdG9yYWdlRGlyKHN0b3JhZ2VQYXRoLCBidWlsZFBhdGgpIHtcbiAgICBjb25zb2xlLmxvZyhgSW5pdGlhbGl6aW5nIHRoZSBzdG9yYWdlIGRpcmVjdG9yeSAuLi5gKVxuXG4gICAgaWYgKCFmcy5leGlzdHNTeW5jKHN0b3JhZ2VQYXRoKSl7XG4gICAgICAgIGZzLm1rZGlyU3luYyhzdG9yYWdlUGF0aCk7XG4gICAgfVxuXG4gICAgaWYgKEFwaXJWZXJzaW9uID09PSB1bmRlZmluZWQpIHRocm93IG5ldyBFcnJvcihcIkFQSVIgdmVyc2lvbiBub3QgbG9hZGVkLiBUaGlzIGlzIHVuZXhwZWN0ZWQuXCIpO1xuXG4gICAgTG9jYWxCdWlsZERpciA9IGAke3N0b3JhZ2VQYXRofS8ke0FwaXJWZXJzaW9ufWA7XG4gICAgaWYgKCFmcy5leGlzdHNTeW5jKExvY2FsQnVpbGREaXIpKXtcbiAgICAgICAgYXdhaXQgY29weVJlY3Vyc2l2ZShidWlsZFBhdGgsIExvY2FsQnVpbGREaXIpXG4gICAgICAgIGNvbnNvbGUubG9nKCdDb3B5IGNvbXBsZXRlJyk7XG4gICAgfVxufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gYWN0aXZhdGUoZXh0ZW5zaW9uQ29udGV4dDogZXh0ZW5zaW9uQXBpLkV4dGVuc2lvbkNvbnRleHQpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAvLyBpbml0aWFsaXplIHRoZSBnbG9iYWwgdmFyaWFibGVzIC4uLlxuICAgIEV4dGVuc2lvblN0b3JhZ2VQYXRoID0gZXh0ZW5zaW9uQ29udGV4dC5zdG9yYWdlUGF0aDtcbiAgICBjb25zb2xlLmxvZyhcIkFjdGl2YXRpbmcgdGhlIEFQSSBSZW1vdGluZyBleHRlbnNpb24gLi4uXCIpXG5cbiAgIC8vIHJlZ2lzdGVyIHRoZSBjb21tYW5kIHJlZmVyZW5jZWQgaW4gcGFja2FnZS5qc29uIGZpbGVcbiAgICBjb25zdCBtZW51Q29tbWFuZCA9IGV4dGVuc2lvbkFwaS5jb21tYW5kcy5yZWdpc3RlckNvbW1hbmQoJ2xsYW1hLmNwcC5hcGlyLm1lbnUnLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGlmIChGQUlMX0lGX05PVF9NQUMgJiYgIWV4dGVuc2lvbkFwaS5lbnYuaXNNYWMpIHtcbiAgICAgICAgICAgIGF3YWl0IGV4dGVuc2lvbkFwaS53aW5kb3cuc2hvd0Vycm9yTWVzc2FnZShgbGxhbWEuY3BwIEFQSSBSZW1vdGluZyBvbmx5IHN1cHBvcnRlZCBvbiBNYWNPUy5gKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG5cdGxldCBzdGF0dXMgPSBcIihzdGF0dXMgaXMgdW5kZWZpbmVkKVwiO1xuXHR0cnkge1xuXHQgICAgc3RhdHVzID0gYXdhaXQgY2hlY2tQb2RtYW5NYWNoaW5lU3RhdHVzKGZhbHNlKVxuXHR9IGNhdGNoIChlcnI6IHVua25vd24pIHtcblx0ICAgIGF3YWl0IGV4dGVuc2lvbkFwaS53aW5kb3cuc2hvd0Vycm9yTWVzc2FnZShlcnIpO1xuXHQgICAgcmV0dXJuO1xuXHR9XG5cblx0Y29uc3QgbWFpbl9tZW51X2Nob2ljZXM6IFJlY29yZDxzdHJpbmcsICgpID0+IFByb21pc2U8dm9pZD4gfCB2b2lkPiA9IHt9O1xuXHQvLyBzdGF0dXMgdmFsdWVzOlxuXG5cdC8vICAwID09PiBydW5uaW5nIHdpdGggQVBJIFJlbW90aW5nIHN1cHBvcnRcblx0Ly8gMTAgPT0+IHJ1bm5pbmcgdmZraXQgVk0gaW5zdGVhZCBvZiBrcnVua2l0XG5cdC8vIDExID09PiBrcnVua2l0IG5vdCBydW5uaW5nXG5cdC8vIDEyID09PiBrcnVua2l0IHJ1bm5pbmcgd2l0aG91dCBBUEkgUmVtb3Rpbmdcblx0Ly8gMnggPT0+IHNjcmlwdCBjYW5ub3QgcnVuIGNvcnJlY3RseVxuXG5cdC8vICAxID09PiBydW5uaW5nIHdpdGggYSBjb250YWluZXIgbGF1bmNoZWRcblx0Ly8xMjcgPT0+IEFQSVIgZmlsZXMgbm90IGF2YWlsYWJsZVxuXG5cdGxldCBzdGF0dXNfc3RyO1xuXHRpZiAoc3RhdHVzID09PSAxMjcpIHsgLy8gZmlsZXMgaGF2ZSBiZWVuIHVuaW5zdGFsbGVkXG5cdCAgICBzdGF0dXNfc3RyID0gXCJBUEkgUmVtb3RpbmcgYmluYXJpZXMgYXJlIG5vdCBpbnN0YWxsZWRcIlxuXHQgICAgbWFpbl9tZW51X2Nob2ljZXNbXCJSZWluc3RhbGwgdGhlIEFQSSBSZW1vdGluZyBiaW5hcmllc1wiXSA9IGluc3RhbGxBcGlyQmluYXJpZXM7XG5cblx0fSBlbHNlIGlmIChzdGF0dXMgPT09IDAgfHwgc3RhdHVzID09PSAxKSB7IC8vIHJ1bm5pbmcgd2l0aCBBUEkgUmVtb3Rpbmcgc3VwcG9ydFxuXHQgICAgaWYgKHN0YXR1cyA9PT0gMCkge1xuXHRcdHN0YXR1c19zdHIgPSBcIlZNIGlzIHJ1bm5pbmcgd2l0aCBBUEkgUmVtb3Rpbmcg8J+OiVwiXG5cdFx0bWFpbl9tZW51X2Nob2ljZXNbXCJMYXVuY2ggYW4gQVBJIFJlbW90aW5nIGFjY2VsZXJhdGVkIEluZmVyZW5jZSBTZXJ2ZXJcIl0gPSBsYXVuY2hBcGlySW5mZXJlbmNlU2VydmVyO1xuXHRcdG1haW5fbWVudV9jaG9pY2VzW1wiU2hvdyBSYW1hTGFtYSBtb2RlbCBsYXVuY2ggY29tbWFuZFwiXSA9IHNob3dSYW1hbGFtYVJ1bjtcblx0XHRtYWluX21lbnVfY2hvaWNlc1tcIlNob3cgUmFtYUxhbWEgYmVuY2htYXJrIGNvbW1hbmRzXCJdID0gc2hvd1JhbWFsYW1hQmVuY2htYXJrO1xuXHQgICAgfSBlbHNlIHtcblx0XHRzdGF0dXNfc3RyID0gXCJhbiBBUEkgUmVtb3RpbmcgaW5mZXJlbmNlIHNlcnZlciBpcyBhbHJlYWR5IHJ1bm5pbmdcIlxuXHRcdG1haW5fbWVudV9jaG9pY2VzW1wiU2hvdyBSYW1hTGFtYSBjaGF0IGNvbW1hbmRcIl0gPSBzaG93UmFtYWxhbWFDaGF0O1xuXHRcdG1haW5fbWVudV9jaG9pY2VzW1wiU3RvcCB0aGUgQVBJIFJlbW90aW5nIEluZmVyZW5jZSBTZXJ2ZXJcIl0gPSBzdG9wQXBpckluZmVyZW5jZVNlcnZlcjtcblx0ICAgIH1cblx0ICAgIG1haW5fbWVudV9jaG9pY2VzW1wiLS0tXCJdID0gZnVuY3Rpb24oKSB7fTtcblx0ICAgIG1haW5fbWVudV9jaG9pY2VzW1wiUmVzdGFydCBQb2RNYW4gTWFjaGluZSB3aXRob3V0IEFQSSBSZW1vdGluZ1wiXSA9IHJlc3RhcnRfcG9kbWFuX21hY2hpbmVfd2l0aG91dF9hcGlyO1xuXG5cdH0gZWxzZSBpZiAoc3RhdHVzID09PSAxMCB8fCBzdGF0dXMgPT09IDExIHx8IHN0YXR1cyA9PT0gMTIpIHtcblx0ICAgIGlmIChzdGF0dXMgPT09IDEwKSB7XG5cdFx0c3RhdHVzX3N0ciA9IFwiVk0gaXMgcnVubmluZyB3aXRoIHZma2l0XCI7XG5cdCAgICB9IGVsc2UgaWYgKHN0YXR1cyA9PT0gMTEpIHtcblx0XHRzdGF0dXNfc3RyID0gXCJWTSBpcyBub3QgcnVubmluZ1wiO1xuXHQgICAgfSBlbHNlIGlmIChzdGF0dXMgPT09IDEyKSB7XG5cdFx0c3RhdHVzX3N0ciA9IFwiVk0gaXMgcnVubmluZyB3aXRob3V0IEFQSSBSZW1vdGluZ1wiO1xuXHQgICAgfVxuXHQgICAgbWFpbl9tZW51X2Nob2ljZXNbXCJSZXN0YXJ0IFBvZE1hbiBNYWNoaW5lIHdpdGggQVBJIFJlbW90aW5nIHN1cHBvcnRcIl0gPSByZXN0YXJ0X3BvZG1hbl9tYWNoaW5lX3dpdGhfYXBpcjtcblx0ICAgIG1haW5fbWVudV9jaG9pY2VzW1wiVW5pbnN0YWxsIHRoZSBBUEkgUmVtb3RpbmcgYmluYXJpZXNcIl0gPSB1bmluc3RhbGxBcGlyQmluYXJpZXM7XG5cdH1cblxuXHRtYWluX21lbnVfY2hvaWNlc1tcIi0tLVwiXSA9IGZ1bmN0aW9uKCkge307XG5cdG1haW5fbWVudV9jaG9pY2VzW1wiQ2hlY2sgUG9kTWFuIE1hY2hpbmUgQVBJIFJlbW90aW5nIHN0YXR1c1wiXSA9ICgpID0+IGNoZWNrUG9kbWFuTWFjaGluZVN0YXR1cyh0cnVlKTtcblxuICAgICAgICAvLyBkaXNwbGF5IGEgY2hvaWNlIHRvIHRoZSB1c2VyIGZvciBzZWxlY3Rpbmcgc29tZSB2YWx1ZXNcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93UXVpY2tQaWNrKE9iamVjdC5rZXlzKG1haW5fbWVudV9jaG9pY2VzKSwge1xuICAgICAgICAgICAgdGl0bGU6IGBXaGF0IGRvXG55b3Ugd2FudCB0byBkbz8gKCR7c3RhdHVzX3N0cn0pYCxcbiAgICAgICAgICAgIGNhblBpY2tNYW55OiBmYWxzZSwgLy8gdXNlciBjYW4gc2VsZWN0IG1vcmUgdGhhbiBvbmUgY2hvaWNlXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGlmIChyZXN1bHQgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgY29uc29sZS5sb2coXCJObyB1c2VyIGNob2ljZSwgYWJvcnRpbmcuXCIpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGF3YWl0IG1haW5fbWVudV9jaG9pY2VzW3Jlc3VsdF0oKTtcbiAgICAgICAgfSBjYXRjaCAoZXJyOiB1bmtub3duKSB7XG4gICAgICAgICAgICBjb25zdCBtc2cgPSBgVGFzayBmYWlsZWQ6ICR7U3RyaW5nKGVycil9YDtcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IobXNnKTtcbiAgICAgICAgICAgIGF3YWl0IGV4dGVuc2lvbkFwaS53aW5kb3cuc2hvd0Vycm9yTWVzc2FnZShtc2cpO1xuXG4gICAgICAgICAgICB0aHJvdyBlcnI7XG4gICAgICAgIH1cbiAgICB9KTtcblxuICAgIHRyeSB7XG4gICAgICAgIC8vIGNyZWF0ZSBhbiBpdGVtIGluIHRoZSBzdGF0dXMgYmFyIHRvIHJ1biBvdXIgY29tbWFuZFxuICAgICAgICAvLyBpdCB3aWxsIHN0aWNrIG9uIHRoZSBsZWZ0IG9mIHRoZSBzdGF0dXMgYmFyXG5cdFN0YXR1c0JhciA9IGV4dGVuc2lvbkFwaS53aW5kb3cuY3JlYXRlU3RhdHVzQmFySXRlbShleHRlbnNpb25BcGkuU3RhdHVzQmFyQWxpZ25MZWZ0LCAxMDApO1xuXG5cdHNldFN0YXR1cyhcIuKame+4jyBJbml0aWFsaXppbmcgLi4uXCIpO1xuICAgICAgICBTdGF0dXNCYXIuY29tbWFuZCA9ICdsbGFtYS5jcHAuYXBpci5tZW51JztcbiAgICAgICAgU3RhdHVzQmFyLnNob3coKTtcblxuICAgICAgICAvLyByZWdpc3RlciBkaXNwb3NhYmxlIHJlc291cmNlcyB0byBpdCdzIHJlbW92ZWQgd2hlbiB5b3UgZGVhY3RpdnRlIHRoZSBleHRlbnNpb25cbiAgICAgICAgZXh0ZW5zaW9uQ29udGV4dC5zdWJzY3JpcHRpb25zLnB1c2gobWVudUNvbW1hbmQpO1xuICAgICAgICBleHRlbnNpb25Db250ZXh0LnN1YnNjcmlwdGlvbnMucHVzaChTdGF0dXNCYXIpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnN0IG1zZyA9IGBDb3VsZG4ndCBzdWJzY3JpYmUgdGhlIGV4dGVuc2lvbiB0byBQb2RtYW4gRGVza3RvcDogJHtlcnJvcn1gXG5cbiAgICAgICAgYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93RXJyb3JNZXNzYWdlKG1zZyk7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihtc2cpO1xuICAgIH1cblxuICAgIHRyeSB7XG5cdHNldFN0YXR1cyhcIkluc3RhbGxpbmcgLi4uXCIpXG5cdGF3YWl0IGluc3RhbGxBcGlyQmluYXJpZXMoKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuXHRyZXR1cm47IC8vIG1lc3NhZ2UgYWxyZWFkeSBwcmludGVkIG9uIHNjcmVlblxuICAgIH1cblxuICAgIHNldFN0YXR1cyhg4pqZ77iPIExvYWRpbmcgdGhlIG1vZGVscyAuLi5gKTtcbiAgICB0cnkge1xuXHRyZWZyZXNoQXZhaWxhYmxlTW9kZWxzKCk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc3QgbXNnID0gYENvdWxkbid0IGluaXRpYWxpemUgdGhlIGV4dGVuc2lvbjogJHtlcnJvcn1gXG5cbiAgICAgICAgYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93RXJyb3JNZXNzYWdlKG1zZyk7XG5cdHNldFN0YXR1cyhg8J+UtCAke21zZ31gKTtcblx0cmV0dXJuXG4gICAgfVxuXG4gICAgc2V0U3RhdHVzKCk7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBkZWFjdGl2YXRlKCk6IFByb21pc2U8dm9pZD4ge1xuXG59XG5cbmFzeW5jIGZ1bmN0aW9uIGluc3RhbGxBcGlyQmluYXJpZXMoKSB7XG4gICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgaW5pdGlhbGl6ZUJ1aWxkRGlyKEVYVEVOU0lPTl9CVUlMRF9QQVRIKTtcbiAgICAgICAgY29uc29sZS5sb2coYEluc3RhbGxpbmcgQVBJUiB2ZXJzaW9uICR7QXBpclZlcnNpb259IC4uLmApO1xuXHRTdGF0dXNCYXIudG9vbHRpcCA9IGB2ZXJzaW9uICR7QXBpclZlcnNpb259YDtcbiAgICAgICAgY29uc29sZS5sb2coYFVzaW5nIGltYWdlICR7UmFtYWxhbWFSZW1vdGluZ0ltYWdlfWApO1xuXG5cdHNldFN0YXR1cyhg4pqZ77iPIEV4dHJhY3RpbmcgdGhlIGJpbmFyaWVzIC4uLmApO1xuICAgICAgICBhd2FpdCBpbml0aWFsaXplU3RvcmFnZURpcihFeHRlbnNpb25TdG9yYWdlUGF0aCwgRVhURU5TSU9OX0JVSUxEX1BBVEgpO1xuXG4gICAgICAgIHNldFN0YXR1cyhg4pqZ77iPIFByZXBhcmluZyBrcnVua2l0IC4uLmApO1xuICAgICAgICBhd2FpdCBwcmVwYXJlX2tydW5raXQoKTtcblx0c2V0U3RhdHVzKGDinIUgYmluYXJpZXMgaW5zdGFsbGVkYCk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc3QgbXNnID0gYENvdWxkbid0IGluaXRpYWxpemUgdGhlIGV4dGVuc2lvbjogJHtlcnJvcn1gXG5cdHNldFN0YXR1cyhg8J+UtCAke21zZ31gKTtcbiAgICAgICAgYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93RXJyb3JNZXNzYWdlKG1zZyk7XG5cdHRocm93IGVycm9yO1xuICAgIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gdW5pbnN0YWxsQXBpckJpbmFyaWVzKCkge1xuICAgIGlmIChFeHRlbnNpb25TdG9yYWdlUGF0aCA9PT0gdW5kZWZpbmVkKSB0aHJvdyBuZXcgRXJyb3IoJ0V4dGVuc2lvblN0b3JhZ2VQYXRoIG5vdCBkZWZpbmVkIDovJyk7XG4gICAgc2V0U3RhdHVzKGDimpnvuI8gVW5pbnN0YWxsaW5nIHRoZSBiaW5hcmllcyAuLi5gKTtcbiAgICBjb25zdCB0b0RlbGV0ZSA9IFtdO1xuXG4gICAgcmVnaXN0ZXJGcm9tRGlyKEV4dGVuc2lvblN0b3JhZ2VQYXRoLCAnY2hlY2tfcG9kbWFuX21hY2hpbmVfc3RhdHVzLnNoJywgZnVuY3Rpb24oZmlsZW5hbWUpIHt0b0RlbGV0ZS5wdXNoKHBhdGguZGlybmFtZShmaWxlbmFtZSkpfSk7XG5cbiAgICBmb3IgKGNvbnN0IGRpck5hbWUgb2YgdG9EZWxldGUpIHtcblx0Y29uc29sZS53YXJuKFwi4pqg77iPIGRlbGV0aW5nIEFQSVIgZGlyZWN0b3J5OiBcIiwgZGlyTmFtZSk7XG5cblx0ZnMucm1TeW5jKGRpck5hbWUsIHsgcmVjdXJzaXZlOiB0cnVlLCBmb3JjZTogdHJ1ZSB9KTtcbiAgICB9XG4gICAgY29uc29sZS53YXJuKFwi4pqg77iPIGRlbGV0aW5nIGRvbmVcIik7XG5cbiAgICBzZXRTdGF0dXMoYOKchSBiaW5hcmllcyB1bmluc3RhbGxlZCDwn5GLYCk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJlc3RhcnRfcG9kbWFuX21hY2hpbmVfd2l0aF9hcGlyKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmIChMb2NhbEJ1aWxkRGlyID09PSB1bmRlZmluZWQpIHRocm93IG5ldyBFcnJvcihcIkxvY2FsQnVpbGREaXIgbm90IGxvYWRlZC4gVGhpcyBpcyB1bmV4cGVjdGVkLlwiKTtcblxuICAgIHRyeSB7XG5cdHNldFN0YXR1cyhcIuKame+4jyBSZXN0YXJ0aW5nIFBvZE1hbiBNYWNoaW5lIHdpdGggQVBJIFJlbW90aW5nIHN1cHBvcnQgLi4uXCIpXG4gICAgICAgIGNvbnN0IHsgc3Rkb3V0IH0gPSBhd2FpdCBleHRlbnNpb25BcGkucHJvY2Vzcy5leGVjKFwiL3Vzci9iaW4vZW52XCIsIFtcImJhc2hcIiwgYCR7TG9jYWxCdWlsZERpcn0vcG9kbWFuX3N0YXJ0X21hY2hpbmUuYXBpX3JlbW90aW5nLnNoYF0sIHtjd2Q6IExvY2FsQnVpbGREaXJ9KTtcblxuICAgICAgICBjb25zdCBtc2cgPSBcIvCfn6IgUG9kTWFuIE1hY2hpbmUgc3VjY2Vzc2Z1bGx5IHJlc3RhcnRlZCB3aXRoIEFQSSBSZW1vdGluZyBzdXBwb3J0XCJcbiAgICAgICAgYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93SW5mb3JtYXRpb25NZXNzYWdlKG1zZyk7XG4gICAgICAgIGNvbnNvbGUubG9nKG1zZyk7XG5cdHNldFN0YXR1cyhcIvCfn6IgQVBJIFJlbW90aW5nIHN1cHBvcnQgZW5hYmxlZFwiKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zdCBtc2cgPSBgRmFpbGVkIHRvIHJlc3RhcnQgUG9kTWFuIE1hY2hpbmUgd2l0aCB0aGUgQVBJIFJlbW90aW5nIHN1cHBvcnQ6ICR7ZXJyb3J9YFxuICAgICAgICBhd2FpdCBleHRlbnNpb25BcGkud2luZG93LnNob3dFcnJvck1lc3NhZ2UobXNnKTtcbiAgICAgICAgY29uc29sZS5lcnJvcihtc2cpO1xuXHRzZXRTdGF0dXMoYPCflLQgJHttc2d9YCk7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihtc2cpO1xuICAgIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gcmVzdGFydF9wb2RtYW5fbWFjaGluZV93aXRob3V0X2FwaXIoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdHJ5IHtcblx0c2V0U3RhdHVzKFwi4pqZ77iPIFN0b3BwaW5nIHRoZSBQb2RNYW4gTWFjaGluZSAuLi5cIilcbiAgICAgICAgY29uc3QgeyBzdGRvdXQgfSA9IGF3YWl0IGV4dGVuc2lvbkFwaS5wcm9jZXNzLmV4ZWMoXCJwb2RtYW5cIiwgWydtYWNoaW5lJywgJ3N0b3AnXSk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc3QgbXNnID0gYEZhaWxlZCB0byBzdG9wIHRoZSBQb2RNYW4gTWFjaGluZTogJHtlcnJvcn1gO1xuXHRzZXRTdGF0dXMoYPCflLQgJHttc2d9YCk7XG4gICAgICAgIGF3YWl0IGV4dGVuc2lvbkFwaS53aW5kb3cuc2hvd0Vycm9yTWVzc2FnZShtc2cpO1xuICAgICAgICBjb25zb2xlLmVycm9yKG1zZyk7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihtc2cpO1xuICAgIH1cblxuICAgIHRyeSB7XG5cdHNldFN0YXR1cyhcIuKame+4jyBSZXN0YXJ0aW5nIHRoZSBkZWZhdWx0IFBvZE1hbiBNYWNoaW5lIC4uLlwiKVxuICAgICAgICBjb25zdCB7IHN0ZG91dCB9ID0gYXdhaXQgZXh0ZW5zaW9uQXBpLnByb2Nlc3MuZXhlYyhcInBvZG1hblwiLCBbJ21hY2hpbmUnLCAnc3RhcnQnXSk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc3QgbXNnID0gYEZhaWxlZCB0byByZXN0YXJ0IHRoZSBQb2RNYW4gTWFjaGluZTogJHtlcnJvcn1gO1xuXHRzZXRTdGF0dXMoYPCflLQgJHttc2d9YCk7XG4gICAgICAgIGF3YWl0IGV4dGVuc2lvbkFwaS53aW5kb3cuc2hvd0Vycm9yTWVzc2FnZShtc2cpO1xuICAgICAgICBjb25zb2xlLmVycm9yKG1zZyk7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihtc2cpO1xuICAgIH1cblxuICAgIGNvbnN0IG1zZyA9IFwiUG9kTWFuIE1hY2hpbmUgc3VjY2Vzc2Z1bGx5IHJlc3RhcnRlZCB3aXRob3V0IEFQSSBSZW1vdGluZyBzdXBwb3J0XCI7XG4gICAgYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93SW5mb3JtYXRpb25NZXNzYWdlKG1zZyk7XG4gICAgY29uc29sZS5sb2cobXNnKTtcbiAgICBzZXRTdGF0dXMoXCLwn5+gIFJ1bm5pbmcgd2l0aG91dCBBUEkgUmVtb3Rpbmcgc3VwcG9ydFwiKVxufVxuXG5hc3luYyBmdW5jdGlvbiBwcmVwYXJlX2tydW5raXQoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKExvY2FsQnVpbGREaXIgPT09IHVuZGVmaW5lZCkgdGhyb3cgbmV3IEVycm9yKFwiTG9jYWxCdWlsZERpciBub3QgbG9hZGVkLiBUaGlzIGlzIHVuZXhwZWN0ZWQuXCIpO1xuXG4gICAgaWYgKGZzLmV4aXN0c1N5bmMoYCR7TG9jYWxCdWlsZERpcn0vYmluL2tydW5raXRgKSkge1xuICAgICAgICBjb25zb2xlLmxvZyhcIkJpbmFyaWVzIGFscmVhZHkgcHJlcGFyZWQuXCIpXG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBzZXRTdGF0dXMoYOKame+4jyBQcmVwYXJpbmcgdGhlIGtydW5raXQgYmluYXJpZXMgZm9yIEFQSSBSZW1vdGluZyAuLi5gKTtcbiAgICBpZiAoIWZzLmV4aXN0c1N5bmMoYCR7TG9jYWxCdWlsZERpcn0vdXBkYXRlX2tydW5raXQuc2hgKSkge1xuXHRjb25zdCBtc2cgPSBgQ2Fubm90IHByZXBhcmUgdGhlIGtydW5raXQgYmluYXJpZXM6ICR7TG9jYWxCdWlsZERpcn0vdXBkYXRlX2tydW5raXQuc2ggZG9lcyBub3QgZXhpc3RgXG5cdGNvbnNvbGUuZXJyb3IobXNnKTtcblx0dGhyb3cgbmV3IEVycm9yKG1zZyk7XG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgICAgY29uc3QgeyBzdGRvdXQgfSA9IGF3YWl0IGV4dGVuc2lvbkFwaS5wcm9jZXNzLmV4ZWMoXCIvdXNyL2Jpbi9lbnZcIiwgW1wiYmFzaFwiLCBgJHtMb2NhbEJ1aWxkRGlyfS91cGRhdGVfa3J1bmtpdC5zaGBdLCB7Y3dkOiBMb2NhbEJ1aWxkRGlyfSk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcihlcnJvcik7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgQ291bGRuJ3QgdXBkYXRlIHRoZSBrcnVua2l0IGJpbmFyaWVzOiAke2Vycm9yfTogJHtlcnJvci5zdGRvdXR9YCk7XG4gICAgfVxuICAgIHNldFN0YXR1cyhg4pyFIGJpbmFyaWVzIHByZXBhcmVkIWApO1xufVxuXG5hc3luYyBmdW5jdGlvbiBjaGVja1BvZG1hbk1hY2hpbmVTdGF0dXMod2l0aF9ndWk6IGJvb2xlYW4pOiBQcm9taXNlPG51bWJlcj4ge1xuICAgIGlmICghZnMuZXhpc3RzU3luYyhgJHtMb2NhbEJ1aWxkRGlyfS9jaGVja19wb2RtYW5fbWFjaGluZV9zdGF0dXMuc2hgKSkge1xuXHRjb25zb2xlLmxvZyhgY2hlY2tQb2RtYW5NYWNoaW5lU3RhdHVzOiBzY3JpcHQgbm90IGZvdW5kIGluICR7TG9jYWxCdWlsZERpcn1gKVxuXHRzZXRTdGF0dXMoXCLim5Qgbm90IGluc3RhbGxlZFwiKTtcblx0aWYgKHdpdGhfZ3VpKSB7XG5cdCAgICBhd2FpdCBleHRlbnNpb25BcGkud2luZG93LnNob3dJbmZvcm1hdGlvbk1lc3NhZ2UoXCLim5QgQVBJIFJlbW90aW5nIGJpbmFyaWVzIGFyZSBub3QgaW5zdGFsbGVkXCIpO1xuICAgICAgICB9XG5cdHJldHVybiAxMjc7XG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgICAgY29uc3QgeyBzdGRvdXQgfSA9IGF3YWl0IGV4dGVuc2lvbkFwaS5wcm9jZXNzLmV4ZWMoXCIvdXNyL2Jpbi9lbnZcIiwgW1wiYmFzaFwiLCBgJHtMb2NhbEJ1aWxkRGlyfS9jaGVja19wb2RtYW5fbWFjaGluZV9zdGF0dXMuc2hgXSwge2N3ZDogTG9jYWxCdWlsZERpcn0pO1xuICAgICAgICAvLyBleGl0IHdpdGggc3VjY2Vzcywga3J1bmtpdCBpcyBydW5uaW5nIEFQSSByZW1vdGluZ1xuICAgICAgICBjb25zdCBzdGF0dXMgPSBzdGRvdXQucmVwbGFjZSgvXFxuJC8sIFwiXCIpXG4gICAgICAgIGNvbnN0IG1zZyA9IGBQb2RtYW4gTWFjaGluZSBBUEkgUmVtb3Rpbmcgc3RhdHVzOlxcbiR7c3RhdHVzfWBcbiAgICAgICAgaWYgKHdpdGhfZ3VpKSB7XG4gICAgICAgICAgICBhd2FpdCBleHRlbnNpb25BcGkud2luZG93LnNob3dJbmZvcm1hdGlvbk1lc3NhZ2UobXNnKTtcbiAgICAgICAgfVxuICAgICAgICBjb25zb2xlLmxvZyhtc2cpO1xuXHRjb25zdCBjb250YWluZXJJbmZvID0gYXdhaXQgaGFzQXBpckNvbnRhaW5lclJ1bm5pbmcoKTtcblx0aWYgKGNvbnRhaW5lckluZm8gIT09IHVuZGVmaW5lZCkge1xuXHQgICAgc2V0U3RhdHVzKGDwn5+iIEluZmVyZW5jZSBTZXJ2ZXIgcnVubmluZ2ApO1xuXHQgICAgcmV0dXJuIDE7XG5cdH0gZWxzZSB7XG5cdCAgICBzZXRTdGF0dXMoXCLwn5+iXCIpO1xuXHQgICAgcmV0dXJuIDA7XG5cdH1cblxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGxldCBtc2c7XG4gICAgICAgIGNvbnN0IHN0YXR1cyA9IGVycm9yLnN0ZG91dC5yZXBsYWNlKC9cXG4kLywgXCJcIilcbiAgICAgICAgY29uc3QgZXhpdENvZGUgPSBlcnJvci5leGl0Q29kZTtcblxuICAgICAgICBpZiAoZXhpdENvZGUgPiAxMCAmJiBleGl0Q29kZSA8IDIwKSB7XG4gICAgICAgICAgICAvLyBleGl0IHdpdGggY29kZSAxeCA9PT4gc3VjY2Vzc2Z1bCBjb21wbGV0aW9uLCBidXQgbm90IEFQSSBSZW1vdGluZyBzdXBwb3J0XG4gICAgICAgICAgICBtc2cgPWDwn5+gIFBvZG1hbiBNYWNoaW5lIHN0YXR1czogJHtzdGF0dXN9YDtcbiAgICAgICAgICAgIGlmICh3aXRoX2d1aSkge1xuICAgICAgICAgICAgICAgIGF3YWl0IGV4dGVuc2lvbkFwaS53aW5kb3cuc2hvd0luZm9ybWF0aW9uTWVzc2FnZShtc2cpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY29uc29sZS53YXJuKG1zZylcblx0ICAgIGlmIChleGl0Q29kZSA9PT0gMTAgfHwgZXhpdENvZGUgPT09IDEyKSB7XG5cdFx0c2V0U3RhdHVzKFwi8J+foCBQb2RNYW4gTWFjaGluZSBydW5uaW5nIHdpdGhvdXQgQVBJIFJlbW90aW5nIHN1cHBvcnRcIik7XG5cdCAgICB9IGVsc2UgaWYgKGV4aXRDb2RlID09PSAxMSkge1xuXHRcdHNldFN0YXR1cyhcIvCfn6AgUG9kTWFuIE1hY2hpbmUgbm90IHJ1bm5pbmdcIik7XG5cdCAgICB9IGVsc2Uge1xuXHRcdHNldFN0YXR1cyhg8J+UtCBJbnZhbGlkIGNoZWNrIHN0YXR1cyAke2V4aXRDb2RlfWApXG5cdFx0Y29uc29sZS53YXJuKGBJbnZhbGlkIGNoZWNrIHN0YXR1cyAke2V4aXRDb2RlfTogJHtlcnJvci5zdGRvdXR9YClcblx0ICAgIH1cblxuICAgICAgICAgICAgcmV0dXJuIGV4aXRDb2RlO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gb3RoZXIgZXhpdCBjb2RlIGNyYXNoIG9mIHVuc3VjY2Vzc2Z1bCBjb21wbGV0aW9uXG4gICAgICAgIG1zZyA9YEZhaWxlZCB0byBjaGVjayBQb2RNYW4gTWFjaGluZSBzdGF0dXM6ICR7c3RhdHVzfSAoY29kZSAjJHtleGl0Q29kZX0pYDtcbiAgICAgICAgYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93RXJyb3JNZXNzYWdlKG1zZyk7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IobXNnKTtcblx0c2V0U3RhdHVzKGDwn5S0ICR7bXNnfWApXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihtc2cpO1xuICAgIH1cbn1cbiJdLCJuYW1lcyI6WyJjb250YWluZXJFbmdpbmUiLCJjb250YWluZXJJbmZvIiwiZXh0ZW5zaW9uQXBpIiwiaWQiLCJwcm92aWRlciIsImNvbm5lY3Rpb24iLCJpbWFnZUluZm8iLCJtc2ciXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFrQk8sTUFBTSxNQUFBLEdBQWlCO0FBRTlCLE1BQU0sSUFBQSxHQUFPLFFBQVEsTUFBTSxDQUFBO0FBQzNCLE1BQU0sRUFBQSxHQUFLLFFBQVEsSUFBSSxDQUFBO0FBQ3ZCLE1BQU0sUUFBQSxHQUFXLFFBQVEsYUFBYSxDQUFBO0FBRXRDLE1BQU0sa0JBQWtCLEVBQUM7QUFDekIsSUFBSSxvQkFBQSxHQUF1QixNQUFBO0FBRzNCLE1BQU0sb0JBQUEsR0FBdUIsSUFBQSxDQUFLLEtBQUEsQ0FBTSxVQUFVLEVBQUUsR0FBQSxHQUFNLFdBQUE7QUFJMUQsSUFBSSxxQkFBQSxH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
