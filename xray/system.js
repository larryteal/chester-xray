function display_size_data_full(){
  if (performance === undefined) {
    console.log("= Display Size Data: performance NOT supported");
    return;
  }

  var list = performance.getEntriesByType("resource");
  if (list === undefined) {
    console.log("= Display Size Data: performance.getEntriesByType() is  NOT supported");
    return;
  }

  console.log("= Display Size Data");
  for (var i=0; i < list.length; i++) {
	if (list[i].name.includes("shard")){
    console.log("== Resource[" + i + "] - " + list[i].name);
    if ("decodedBodySize" in list[i])
      console.log("... decodedBodySize[" + i + "] = " + list[i].decodedBodySize);
    else
      console.log("... decodedBodySize[" + i + "] = NOT supported");

    if ("encodedBodySize" in list[i])
      console.log("... encodedBodySize[" + i + "] = " + list[i].encodedBodySize);
    else
      console.log("... encodedBodySize[" + i + "] = NOT supported");

    if ("transferSize" in list[i])
      console.log("... transferSize[" + i + "] = " + list[i].transferSize);
    else
      console.log("... transferSize[" + i + "] = NOT supported");
    }
  }
}

function display_size_data(){
  if (performance === undefined) {
    console.log("= Display Size Data: performance NOT supported");
    return;
  }

  var list = performance.getEntriesByType("resource");
  if (list === undefined) {
    console.log("= Display Size Data: performance.getEntriesByType() is  NOT supported");
    return;
  }
  
  var todo = 0
  var total = 0
  for (var i=0; i < list.length; i++) {
	if (list[i].name.includes("shard")){
    	total+=1
    }
  }
  status('Loading model... ' + total + "/" + (8+16));
}

function sleep(ms) {
	  return new Promise(resolve => setTimeout(resolve, ms));
}

const IMAGE_SIZE = 224;
const TOPK_PREDICTIONS = 10;
let mobilenet;
let chestgrad;
let mobileaenet;
let catElement;
let grad_fns;

async function run(){
	status('Loading model...');
	const startTime = performance.now();
	var t=setInterval(display_size_data,100);
	const MODEL_PATH = 'models/chestxnet1';
	mobilenet = await tf.loadFrozenModel(MODEL_PATH + "/tensorflowjs_model.pb", MODEL_PATH + "/weights_manifest.json");
	console.log("First Model loaded " + Math.floor(performance.now() - startTime) + "ms");
	const AEMODEL_PATH = 'models/chestae1';
	mobileaenet = await tf.loadFrozenModel(AEMODEL_PATH + "/tensorflowjs_model.pb", AEMODEL_PATH + "/weights_manifest.json");
	console.log("Second Model loaded " + Math.floor(performance.now() - startTime) + "ms");
	clearInterval(t);
//	status('Loading gradients...');
//	
//	grad_fns = []
//	for (var i = 0; i < 3; i++) {
//		console.log(i)
//		grad_fn = tf.grad(x => mobilenet.predict(x).squeeze().slice(i,1));
//		grad_fns.push(grad_fn)
//	}
	
	status('Loading model into memory...');
	
	await sleep(1000)
	
	chestgrad = tf.grad(x => mobilenet.predict(x))
	
//	mobilenet.predict(tf.zeros([1, 3, IMAGE_SIZE, IMAGE_SIZE])).dispose();
//	mobileaenet.predict(tf.zeros([1, 1, 64, 64])).dispose();
	status('');

	catElement = document.getElementById('cat');

	if (catElement.complete && catElement.naturalHeight !== 0) {
		await predict(catElement);
	} else {
		catElement.onload = () => {
			predict(catElement);
		};
	}

	document.getElementById('file-container').style.display = '';
};

let batched
let grads
let currentpred
async function predict(imgElement) {
	
	try{
		await predict_real(imgElement);
	}catch(err) {
		status("Error! " + err.message);
		console.log(err)
	}
}
async function predict_real(imgElement) {
	status('Predicting...');
	const startTime = performance.now();
	
	currentpred = $("#predtemplate").clone();
	currentpred[0].id = ""
	predictionsElement.insertBefore(currentpred[0], predictionsElement.firstChild);
	
	currentpred.find(".inputimage").attr("src", imgElement.src)
	currentpred[0].style.display="block";
	
	
    const img = tf.fromPixels(imgElement).toFloat();
	
    const normalized = img.div(tf.scalar(255));

    const meanImg = normalized.mean(2)
    
    batched = meanImg.reshape([1, 1, IMAGE_SIZE, IMAGE_SIZE]).tile([1,3,1,1])
	
    console.log("Prepared input image " + Math.floor(performance.now() - startTime) + "ms");
	
	//////// display input image
	imgs = currentpred.find(".inputimage")
	for (i=0; i < imgs.length; i++){
		canvas = imgs[i]

		await tf.toPixels(meanImg,canvas);	
		canvas.style.width = "100%";
		canvas.style.height = "";
		canvas.style.imageRendering = "pixelated";
	}
	////////////////////
	
	status('Computing Reconstruction...');
	
	img_small = document.createElement('img');
	img_small.src = imgElement.src
	img_small.width = 64
	img_small.height = 64
	
	rec = tf.tidy(() => {
		
	    const img = tf.fromPixels(img_small).toFloat();
		
	    const normalized = img.div(tf.scalar(255));
	
	    const batched = normalized.mean(2).reshape([1, 1, 64, 64])
	    
	    const batched2 = batched.mul(2).sub(1)
	    
	    const result = mobileaenet.predict(batched)
	
	    const rec = batched.sub(result).pow(2)
	    
	    return rec
	});
	
	//////// display ood image
	canvas = currentpred.find(".oodimage")[0]
	layer = rec.reshape([64,64])
	await tf.toPixels(layer.div(layer.max()),canvas);	
	canvas.style.width = "100%";
	canvas.style.height = "";
	canvas.style.imageRendering = "pixelated";
	
	ctx = canvas.getContext("2d");
	d = ctx.getImageData(0, 0, canvas.width, canvas.height);
	makeColor(d.data);
	ctx.putImageData(d,0,0);
	
	canvas = currentpred.find(".oodviz .loading")[0].style.display = "none";
	canvas = currentpred.find(".oodimagebox")[0].style.display = "block";
	////////////////////
	
	
	console.log("Computed Reconstruction " + Math.floor(performance.now() - startTime) + "ms");
	
	recScore = rec.mean().dataSync()
	console.log(recScore);

	status('Predicting disease...');
	await sleep(100)
    
	output = tf.tidy(() => {
	 
		const value = mobilenet.execute(batched, ["Sigmoid"])
	    
	    return value
    
	});
  
	
    
	logits = await output.data()

	console.log("Computed logits and grad " + Math.floor(performance.now() - startTime) + "ms");
	
	const classes = await distOverClasses(logits)
	
	//layers.push(["OOD error",rec.reshape([64,64])])
  
	//layers.push(["grad",grad.mean(0).abs().max(0)])
	
//	grad_fn = tf.grad(x => mobilenet.predict(x).squeeze().slice(0,1));
//	
//    const temp = mobilenet.executor.checkTensorForDisposal
//    mobilenet.executor.checkTensorForDisposal=function(){}
//	specificgrad = grad_fn(batched)
//	mobilenet.executor.checkTensorForDisposal = temp
//	
//	layers.push(["specificgrad",specificgrad.mean(0).abs().max(0)])
	
	showProbResults(currentpred.find(".predbox")[0], classes, recScore)
	currentpred.find(".predviz .loading")[0].style.display = "none";
	
	status('Computing gradients...');
	
	await sleep(100)
	
	grad = tf.tidy(() => {
		
	    const temp = mobilenet.executor.checkTensorForDisposal
	    mobilenet.executor.checkTensorForDisposal=function(){}
	    
		const grad = chestgrad(batched);
	    
	    mobilenet.executor.checkTensorForDisposal = temp
	    
	    return grad
    
	});
	
	
	
	//////// display grad image
	canvas = currentpred.find(".gradimage")[0]
	layer = grad.mean(0).abs().max(0)
	await tf.toPixels(layer.div(layer.max()),canvas);	
	canvas.style.width = "100%";
	canvas.style.height = "";
	canvas.style.imageRendering = "pixelated";
	
	ctx = canvas.getContext("2d");
	d = ctx.getImageData(0, 0, canvas.width, canvas.height);
	makeColor(d.data);
	ctx.putImageData(d,0,0);
	
	canvas = currentpred.find(".gradviz .loading")[0].style.display = "none";
	canvas = currentpred.find(".gradimagebox")[0].style.display = "block";
	////////////////////
	

	const totalTime = performance.now() - startTime;
	status(`Done in ${Math.floor(totalTime)}ms`); // Show the classes in the DOM.

	//await showResults(imgElement, layers, classes, recScore);
	console.log("results plotted " + Math.floor(performance.now() - startTime) + "ms");
	
}

async function distOverClasses(values){
	
	pathologies = ["Atelectasis", "Consolidation", "Infiltration",
        "Pneumothorax", "Edema", "Emphysema", "Fibrosis", "Effusion", "Pneumonia",
        "Pleural_Thickening", "Cardiomegaly", "Nodule", "Mass", "Hernia"]
	
	values = values.subarray(0,pathologies.length)
	
	const topClassesAndProbs = [];
	for (let i = 0; i < values.length; i++) {
	    topClassesAndProbs.push({
	      className: pathologies[i],
	      probability: values[i]
	    });
	}
	return topClassesAndProbs
}



async function getTopKClasses(logits, topK) {
  const values = await logits.data();
  const valuesAndIndices = [];

  for (let i = 0; i < values.length; i++) {
    valuesAndIndices.push({
      value: values[i],
      index: i
    });
  }

  valuesAndIndices.sort((a, b) => {
    return b.value - a.value;
  });
  const topkValues = new Float32Array(topK);
  const topkIndices = new Int32Array(topK);

  for (let i = 0; i < topK; i++) {
    topkValues[i] = valuesAndIndices[i].value;
    topkIndices[i] = valuesAndIndices[i].index;
  }

  const topClassesAndProbs = [];

  for (let i = 0; i < topkIndices.length; i++) {
    topClassesAndProbs.push({
      className: IMAGENET_CLASSES[topkIndices[i]],
      probability: topkValues[i]
    });
  }

  return topClassesAndProbs;
}

function decimalToHexString(number){
  if (number < 0){
    number = 0xFFFFFFFF + number + 1;
  }
  return number.toString(16).toUpperCase();
}


function invertColors(data) {
  for (var i = 0; i < data.length; i+= 4) {
    data[i] = data[i] ^ 255; // Invert Red
    data[i+1] = data[i+1] ^ 255; // Invert Green
    data[i+2] = data[i+2] ^ 255; // Invert Blue
  }
}

function enforceBounds(x) {
    if (x < 0) {
        return 0;
    } else if (x > 1){
        return 1;
    } else {
        return x;
    }
}
function interpolateLinearly(x, values) {
    // Split values into four lists
    var x_values = [];
    var r_values = [];
    var g_values = [];
    var b_values = [];
    for (i in values) {
        x_values.push(values[i][0]);
        r_values.push(values[i][1][0]);
        g_values.push(values[i][1][1]);
        b_values.push(values[i][1][2]);
    }
    var i = 1;
    while (x_values[i] < x) {
        i = i+1;
    }
    i = i-1;
    var width = Math.abs(x_values[i] - x_values[i+1]);
    var scaling_factor = (x - x_values[i]) / width;
    // Get the new color values though interpolation
    var r = r_values[i] + scaling_factor * (r_values[i+1] - r_values[i])
    var g = g_values[i] + scaling_factor * (g_values[i+1] - g_values[i])
    var b = b_values[i] + scaling_factor * (b_values[i+1] - b_values[i])
    return [enforceBounds(r), enforceBounds(g), enforceBounds(b)];
}


function makeColor(data) {
	
	  for (var i = 0; i < data.length; i+= 4) {
		var color = interpolateLinearly(data[i]/255, jet);
	    data[i] = Math.round(255*color[0]); // Invert Red
	    data[i+1] = Math.round(255*color[1]); // Invert Green
	    data[i+2] = Math.round(255*color[2]); // Invert Blue
	  }
	}

async function showProbResults(predictionContainer, classes, recScore) {
		
	const probsContainer = document.createElement('div');
	probsContainer.style.width="100%"
	
	if (recScore > 0.5){
		const row = document.createElement('div');
		row.className = 'row';
		row.style.width="100%"
		row.textContent = "This image is too far out of our training distribution so we will not process it. (recScore:" + (Math.round(recScore * 100) / 100) + ")"
		probsContainer.appendChild(row);
	}else{		
		for (let i = 0; i < classes.length; i++) {
		    const row = document.createElement('div');
		    row.className = 'row';
		    const classElement = document.createElement('div');
		    classElement.className = 'cell';
		    classElement.innerText = classes[i].className;
		    row.appendChild(classElement);
		    const probsElement = document.createElement('div');
		    probsElement.className = 'cell';
		    probsElement.innerText = (classes[i].probability.toFixed(2)*100) + "%";
		    scale = parseInt((1-classes[i].probability)*255)
		    probsElement.style.backgroundColor = "rgb(255," + scale + "," + scale + ")";
		    row.appendChild(probsElement);
		    probsContainer.appendChild(row);
		}
	}

	predictionContainer.appendChild(probsContainer);
	
}


async function showResults(imgElement, layers, classes, recScore) {
	
	const predictionContainer = document.createElement('div');
	predictionContainer.className = 'row';
	const imgContainer = document.createElement('div');
	imgContainer.className="col-xs-3";
	imgElement.style.width = "100%";
	imgElement.height = "auto";
	imgElement.style.height = "auto";
	imgElement.style.display = "";
	imgContainer.appendChild(imgElement);
	predictionContainer.appendChild(imgContainer);
	
	const layersContainer = document.createElement('div');
	layersContainer.className="col-xs-6";
	for(i = 0; i < layers.length; i++){
		layerName = layers[i][0];
		layer = layers[i][1];
		var canvas = document.createElement('canvas');
		await tf.toPixels(layer.div(layer.max()),canvas);		
		canvas.style.width = "100%";
		canvas.style.height = "";
		canvas.style.imageRendering = "pixelated";
		const layerBox = document.createElement('span');
		layerBox.appendChild(canvas);
		
		ctx = canvas.getContext("2d");
		d = ctx.getImageData(0, 0, canvas.width, canvas.height);
		makeColor(d.data);
		ctx.putImageData(d,0,0);
		
		layerBox.appendChild(document.createElement('br'));
		layerBox.style.textAlign="center";
		layerBox.append(layerName);
		//layerBox.innerText = layerName;
		layerBox.className = 'col-xs-3 nopadding';
		
		layersContainer.appendChild(layerBox);
	}
		
	predictionContainer.appendChild(layersContainer);
  
	const probsContainer = document.createElement('div');
	probsContainer.className="col-xs-2";
	
	if (recScore > 0.5){
		const row = document.createElement('div');
		row.className = 'row';
		row.textContent = "This image is too far out of our training distribution so we will not process it. (recScore:" + (Math.round(recScore * 100) / 100) + ")"
		probsContainer.appendChild(row);
	}else{
		const row = document.createElement('div');
		row.className = 'row';
		row.textContent = "Disease Predictions";
		row.style.fontWeight= "600";
		probsContainer.appendChild(row);
		
		for (let i = 0; i < classes.length; i++) {
		    const row = document.createElement('div');
		    row.className = 'row';
		    const classElement = document.createElement('div');
		    classElement.className = 'cell';
		    classElement.innerText = classes[i].className;
		    row.appendChild(classElement);
		    const probsElement = document.createElement('div');
		    probsElement.className = 'cell';
		    probsElement.innerText = (classes[i].probability.toFixed(2)*100) + "%";
		    scale = parseInt((1-classes[i].probability)*255)
		    probsElement.style.backgroundColor = "rgb(255," + scale + "," + scale + ")";
		    row.appendChild(probsElement);
		    probsContainer.appendChild(row);
		}
	}

	predictionContainer.appendChild(probsContainer);
	predictionsElement.insertBefore(document.createElement('hr'), predictionsElement.firstChild);
	predictionsElement.insertBefore(predictionContainer, predictionsElement.firstChild);
	
}

const filesElement = document.getElementById('files');
filesElement.addEventListener('change', evt => {
  let files = evt.target.files; // Display thumbnails & issue call to predict each image.

  for (let i = 0, f; f = files[i]; i++) {
    // Only process image files (skip non image files)
    if (!f.type.match('image.*')) {
      continue;
    }

    let reader = new FileReader();
    const idx = i;

    reader.onload = e => {
      let img = document.createElement('img');
      img.src = e.target.result;
      img.width = IMAGE_SIZE;
      img.height = IMAGE_SIZE;

      img.onload = () => predict(img);
    }; 


    reader.readAsDataURL(f);
  }
});
const statusElement = document.getElementById('status');

const status = msg => statusElement.innerText = msg;

const predictionsElement = document.getElementById('predictions');


function findGetParameter(parameterName) {
    var result = null,
        tmp = [];
    location.search
        .substr(1)
        .split("&")
        .forEach(function (item) {
          tmp = item.split("=");
          if (tmp[0] === parameterName) result = decodeURIComponent(tmp[1]);
        });
    return result;
}

$("#agree").click(function(){
	$("#agree").hide()
	run();
});

