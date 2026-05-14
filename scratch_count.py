import json

data = json.load(open('songs.json', encoding='utf-8'))
urls = []
def get_urls(node):
    if 'url' in node:
        urls.append(node['url'])
    if 'children' in node:
        for c in node['children']:
            get_urls(c)
get_urls(data)
print("Total URLs:", len(urls))
