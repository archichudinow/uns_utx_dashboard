// csv_to_points.js
import * as THREE from 'three';
import Papa from 'papaparse';

function parseCSVToPoints(csvData) {
    const positions = [];
    const colors = [];

    const randomColor = new THREE.Color('gray');

    Papa.parse(csvData, {
        complete: function(results) {
            const data = results.data;

            data.forEach((point, index) => {
                if (point.length === 3) {
                    const x = parseFloat(point[0].trim());
                    const y = parseFloat(point[1].trim());
                    const z = parseFloat(point[2].trim());

                    if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
                        positions.push(x, z, -y); // flip y and z
                        colors.push(randomColor.r, randomColor.g, randomColor.b);
                    } else {
                        console.warn(`Invalid data at row ${index}:`, point);
                    }
                } else {
                    console.warn(`Invalid row format at row ${index}:`, point);
                }
            });
        }
    });

    if (positions.length === 0) {
        console.error("No valid points found.");
        return null;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
        size: 1,
        vertexColors: true,
        sizeAttenuation: false,
        depthWrite: false,
        transparent: true, // this helps AO skip it
    });

    const pointCloud = new THREE.Points(geometry, material);

    // --- NEW: exclude from shadows / AO ---
    pointCloud.castShadow = false;
    pointCloud.receiveShadow = false;

    // Assign to a separate layer (e.g., layer 2) so SAOPass ignores it
    pointCloud.layers.set(2);

    return pointCloud;
}


// Function to fetch and parse the CSV file from a URL
export function loadCSV(url) {
    return new Promise((resolve, reject) => {
        fetch(url)
            .then(response => response.text())
            .then(csvData => {
                const pointCloud = parseCSVToPoints(csvData);
                resolve(pointCloud);
            })
            .catch(error => reject("Error loading CSV file: " + error));
    });
}