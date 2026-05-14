import json
import os

def extract_musica():
    bookmarks_path = r'C:\Users\usuario\AppData\Local\Google\Chrome\User Data\Profile 1\Bookmarks'
    output_path = 'songs.json'
    
    if not os.path.exists(bookmarks_path):
        print(f"Error: {bookmarks_path} not found")
        return

    with open(bookmarks_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    def find_folder(nodes, target_name):
        for node in nodes:
            if node.get('type') == 'folder' and node.get('name') == target_name:
                return node
            if 'children' in node:
                result = find_folder(node['children'], target_name)
                if result:
                    return result
        return None

    # Search in all roots and merge all "Musica" folders found
    roots = data.get('roots', {})
    musica_folder = {
        "name": "Musica",
        "type": "folder",
        "children": []
    }
    
    def collect_musica_folders(nodes):
        for node in nodes:
            if node.get('type') == 'folder' and node.get('name') == 'Musica':
                musica_folder["children"].extend(node.get("children", []))
            if 'children' in node:
                collect_musica_folders(node['children'])

    def deduplicate_folders(node):
        if 'children' not in node:
            return
        
        folder_groups = {}
        new_children = []
        
        for child in node['children']:
            if child.get('type') == 'folder':
                lower_name = child.get('name', '').strip().lower()
                if lower_name in folder_groups:
                    folder_groups[lower_name]['children'].extend(child.get('children', []))
                else:
                    # Keep the exact name of the first occurrence
                    folder_groups[lower_name] = child
                    new_children.append(child)
            else:
                new_children.append(child)
                
        for child in new_children:
            if child.get('type') == 'folder':
                deduplicate_folders(child)
                
        node['children'] = new_children

    for root_name in ['bookmark_bar', 'other', 'synced']:
        if root_name in roots:
            collect_musica_folders([roots[root_name]])
    
    if musica_folder:
        deduplicate_folders(musica_folder)
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(musica_folder, f, indent=4, ensure_ascii=False)
        print(f"Successfully extracted 'Musica' folder to {output_path}")
    else:
        print("Folder 'Musica' not found in bookmarks.")

if __name__ == "__main__":
    extract_musica()
