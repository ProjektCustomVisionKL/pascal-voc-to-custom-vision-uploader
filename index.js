const fs = require('fs');
const { parseStringPromise } = require('xml2js');
const util = require('util');
const TrainingApi = require('@azure/cognitiveservices-customvision-training');
const msRest = require('@azure/ms-rest-js');


const trainingKey = '<TRAINING-KEY>';
const endPoint = 'https://<AZURE-ENDPOINT>.cognitiveservices.azure.com/';
const filesPath = '../images';


const credentials = new msRest.ApiKeyCredentials({ inHeader: { 'Training-key': trainingKey } });
const trainer = new TrainingApi.TrainingAPIClient(credentials, endPoint);

let imagesdir = fs.readdirSync(filesPath);
imagesdir = imagesdir.filter(name => name.endsWith('.xml'));

const setTimeoutPromise = util.promisify(setTimeout);
const fileUploadPromises = [];

async function checkAndSend(projectId, batchImages, forceSend) {
    if ((forceSend && batchImages.length > 0) || batchImages.length === 8) {
        batch = { images: batchImages };
        console.log(batchImages);
        await setTimeoutPromise(1000, null);
        fileUploadPromises.push(trainer.createImagesFromFiles(projectId, batch));
        return true;
    } else {
        return false;
    }
}

(async () => {
    console.log('Creating project...');
    const domains = await trainer.getDomains()
    const objDetectDomain = domains.find(domain => domain.type === 'ObjectDetection');
    const wasteProject = await trainer.createProject('Waste Object Detection Project', { domainId: objDetectDomain.id });

    console.log('Creating tags...');
    // Add own tags
    const plastic = await trainer.createTag(wasteProject.id, 'plastic');
    const metal = await trainer.createTag(wasteProject.id, 'metal');
    const glass = await trainer.createTag(wasteProject.id, 'glass');
    const tags = { plastic, metal, glass };

    console.log('Analyzing and transforming data...');
    let batchImages = [];
    for (let xmlname of imagesdir) {
        const file = fs.readFileSync(`${filesPath}/${xmlname}`);
        const result = await parseStringPromise(file);
        const imgname = result.annotation.filename[0];
        const width = Number(result.annotation.size[0].width[0]);
        const height = Number(result.annotation.size[0].height[0]);
        const regions = [];
        for (let i = 0; i < result.annotation.object.length; ++i) {
            const tagId = tags[result.annotation.object[i].name[0]].id;
            const leftPx = Number(result.annotation.object[i].bndbox[0].xmin[0]);
            const topPx = Number(result.annotation.object[i].bndbox[0].ymin[0]);
            regions.push({
                tagId,
                left: leftPx / width,
                top: topPx / height,
                width: (Number(result.annotation.object[i].bndbox[0].xmax[0]) - leftPx) / width,
                height: (Number(result.annotation.object[i].bndbox[0].ymax[0]) - topPx) / height,
            });
        }
        batchImages.push({ name: imgname, contents: fs.readFileSync(`${filesPath}/${imgname}`), regions });
        if (await checkAndSend(wasteProject.id, batchImages)) {
            batchImages = [];
        }
    }

    await checkAndSend(wasteProject.id, batchImages, true);

    console.log('Uploading data...');
    await Promise.all(fileUploadPromises);
    return;
})();