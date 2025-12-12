// csv_to_points.js
import * as THREE from 'three';
import Papa from 'papaparse';

function parseCSVToPoints(csvData) {
    const positions = [];
    const colors = [];

    // Generate a random color for the entire point cloud
    const randomColor = new THREE.Color(Math.random(), Math.random(), Math.random());

    Papa.parse(csvData, {
        complete: function(results) {
            const data = results.data;
            
            // Process each row (point) from the CSV
            data.forEach((point, index) => {
                // Ensure the row has exactly three values (x, y, z)
                if (point.length === 3) {
                    // Trim any extra spaces before parsing
                    const x = parseFloat(point[0].trim());
                    const y = parseFloat(point[1].trim());
                    const z = parseFloat(point[2].trim());

                    // Check if the values are valid numbers
                    if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
                        // Flip y and z, and multiply z by -1
                        positions.push(x, z, -y);  // Flip y and z, and negate z

                        // Use the same random color for all points in this point cloud
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

    // Ensure we have valid positions before proceeding
    if (positions.length === 0) {
        console.error("No valid points found.");
        return null;
    }

    // Create geometry for the point cloud
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    // Create the points material
    const material = new THREE.PointsMaterial({
        size: 2,
        vertexColors: true,
        sizeAttenuation: false
    });

    const pointCloud = new THREE.Points(geometry, material);
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